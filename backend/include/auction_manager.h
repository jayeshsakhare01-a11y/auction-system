
#ifndef AUCTION_MANAGER_H
#define AUCTION_MANAGER_H

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0501
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <vector>
#include <string>
#include <ctime>
#include <cstdio>
#include <iostream>

#include "bst.h"
#include "linked_list.h"
#include "queue.h"
#include "models.h"
#include "json_util.h"

//  Notification — one entry in the FIFO event feed
struct Notification {
    std::string message;
    time_t      timestamp;
    int         relatedAuctionId;

    JsonObject toJson() const {
        JsonObject obj;
        obj.set("message", message)
           .set("timestamp", (long long)timestamp)
           .set("auctionId", relatedAuctionId);
        return obj;
    }
};


// AuctionManager — Central Auction Engine                                

class AuctionManager {
private:
    // ── Storage ───────────────────────────────────────────────────────────
    std::vector<User*>    users;       // indexed by (id - 1)  [array/vector]
    std::vector<Auction*> auctions;    // indexed by (id - 1)  [array/vector]
    MinBST                expiryTree;  // global Min-BST for close-time tracking
    Queue<Notification>   notifications; // FIFO queue (capped at 200)

    // ── ID generators ─────────────────────────────────────────────────────
    int nextUserId;
    int nextAuctionId;
    int nextBidId;

    // ── Thread safety ─────────────────────────────────────────────────────
    CRITICAL_SECTION cs;               // reentrant mutex (Windows)

public:
    AuctionManager()
        : notifications(200), nextUserId(1), nextAuctionId(1), nextBidId(1)
    {
        InitializeCriticalSection(&cs);
    }

    ~AuctionManager() {
        for (size_t i = 0; i < users.size(); i++)    delete users[i];
        for (size_t i = 0; i < auctions.size(); i++) delete auctions[i];
        DeleteCriticalSection(&cs);
    }

    void lock()   { EnterCriticalSection(&cs); }
    void unlock() { LeaveCriticalSection(&cs); }

    //  USER OPERATIONS
    
    User* createUser(const std::string& name, const std::string& email) {
        lock();
        User* u  = new User();
        u->id    = nextUserId++;
        u->name  = name;
        u->email = email;
        users.push_back(u);

        Notification n;
        n.message          = "New user registered: " + name;
        n.timestamp        = time(NULL);
        n.relatedAuctionId = 0;
        notifications.enqueue(n);

        unlock();
        return u;
    }

    User* getUser(int id) {
        if (id < 1 || id > (int)users.size()) return NULL;
        return users[id - 1];
    }

    std::vector<User*> getAllUsers() {
        return users;
    }

    //  AUCTION OPERATIONS

    Auction* createAuction(const std::string& title, const std::string& desc,
                           const std::string& imageUrl, double startingPrice,
                           int durationSeconds)
    {
        lock();
        Auction* a      = new Auction();
        a->id           = nextAuctionId++;
        a->title        = title;
        a->description  = desc;
        a->imageUrl     = imageUrl;
        a->startingPrice= startingPrice;
        a->startTime    = time(NULL);
        a->endTime      = a->startTime + durationSeconds;
        a->isActive     = true;

        auctions.push_back(a);

        expiryTree.insert(a->endTime, a->id);

        Notification n;
        char buf[256];
        std::snprintf(buf, sizeof(buf),
            "New auction created: \"%s\" (Starting at $%.2f, Duration: %ds)",
            title.c_str(), startingPrice, durationSeconds);
        n.message          = std::string(buf);
        n.timestamp        = time(NULL);
        n.relatedAuctionId = a->id;
        notifications.enqueue(n);

        std::cout << "[AUCTION] Created: " << title
                  << " | Ends at: " << a->endTime << std::endl;
        unlock();
        return a;
    }

    Auction* getAuction(int id) {
        if (id < 1 || id > (int)auctions.size()) return NULL;
        return auctions[id - 1];
    }

    std::vector<Auction*> getActiveAuctions() {
        std::vector<Auction*> result;
        for (size_t i = 0; i < auctions.size(); i++) {
            if (auctions[i]->isActive) result.push_back(auctions[i]);
        }
        return result;
    }

    std::vector<Auction*> getClosedAuctions() {
        std::vector<Auction*> result;
        for (size_t i = 0; i < auctions.size(); i++) {
            if (!auctions[i]->isActive) result.push_back(auctions[i]);
        }
        return result;
    }

    std::vector<Auction*> getAllAuctions() {
        return auctions;
    }

    //  BID PLACEMENT

    // Returns empty string on success, or an error message on failure.
    std::string placeBid(int auctionId, int userId, double amount) {
        lock();

        Auction* a = getAuction(auctionId);
        if (!a) { unlock(); return "Auction not found"; }
        if (!a->isActive) { unlock(); return "Auction is already closed"; }
        if (time(NULL) >= a->endTime) { unlock(); return "Auction has expired"; }

        User* u = getUser(userId);
        if (!u) { unlock(); return "User not found"; }

        // Validate: bid must exceed current highest (or starting price)
        double minBid = (a->highestBid > 0) ? a->highestBid : a->startingPrice;
        if (amount <= minBid) {
            char buf[128];
            std::snprintf(buf, sizeof(buf),
                "Bid must be higher than $%.2f", minBid);
            unlock();
            return std::string(buf);
        }

        // ── Insert into the per-auction Max-BST ──────────────────────────
        int bidId = nextBidId++;
        a->bidTree.insert(amount, bidId, userId, u->name, time(NULL));
        a->highestBid = amount;
        a->totalBids++;

        // ── Append to user's LinkedList bid history ──────────────────────
        BidRecord record;
        record.auctionId    = auctionId;
        record.auctionTitle = a->title;
        record.amount       = amount;
        record.timestamp    = time(NULL);
        record.isWinning    = false;
        u->bidHistory.append(record);

        // ── Notification ─────────────────────────────────────────────────
        Notification n;
        char buf[256];
        std::snprintf(buf, sizeof(buf),
            "%s placed a bid of $%.2f on \"%s\"",
            u->name.c_str(), amount, a->title.c_str());
        n.message          = std::string(buf);
        n.timestamp        = time(NULL);
        n.relatedAuctionId = auctionId;
        notifications.enqueue(n);

        std::cout << "[BID] " << u->name << " → $" << amount
                  << " on \"" << a->title << "\"" << std::endl;

        unlock();
        return "";   // success
    }

    // =====================================================================
    //  AUTOMATED EXPIRY — Called by the background thread every second
    // =====================================================================

    void checkAndCloseExpired() {
        lock();

        time_t now = time(NULL);

        // Keep draining the Min-BST as long as the leftmost node has expired
        while (true) {
            time_t closeTime;
            int    auctionId;
            if (!expiryTree.peekMin(closeTime, auctionId)) break;
            if (closeTime > now) break;   // nothing expired yet

            // ── Remove from Min-BST ──────────────────────────────────────
            expiryTree.removeMin();

            Auction* a = getAuction(auctionId);
            if (!a || !a->isActive) continue;

            // ── Close the auction ────────────────────────────────────────
            a->isActive = false;
            std::cout << "\n[EXPIRY] Closing auction: " << a->title << std::endl;

            if (a->bidTree.isEmpty()) {
                // No bids were placed
                Notification n;
                n.message = "Auction \"" + a->title + "\" closed with no bids.";
                n.timestamp        = now;
                n.relatedAuctionId = auctionId;
                notifications.enqueue(n);
                std::cout << "  → No bids. Auction ended without a winner.\n";
                continue;
            }

            // ── Vickrey (Second-Price) Settlement ────────────────────────
            //  1. Rightmost node of Max-BST  → highest bidder (WINNER)
            //  2. In-order predecessor of max → second-highest (PRICE)
            BidBSTNode* maxNode = a->bidTree.findMax();
            a->winnerId   = maxNode->data.userId;
            a->winnerName = maxNode->data.userName;
            a->highestBid = maxNode->data.amount;

            BidBSTNode* secondMax = a->bidTree.findSecondMax();
            if (secondMax && secondMax != maxNode) {
                a->settledPrice = secondMax->data.amount;   // Vickrey price
            } else {
                a->settledPrice = maxNode->data.amount;     // only one bidder
            }

            // ── Update winner's bid history ──────────────────────────────
            User* winner = getUser(a->winnerId);
            if (winner) {
                for (int i = 0; i < winner->bidHistory.size(); i++) {
                    BidRecord& rec = winner->bidHistory.get(i);
                    if (rec.auctionId == auctionId) {
                        rec.isWinning = true;
                    }
                }
            }

            // ── Notification ─────────────────────────────────────────────
            Notification n;
            char buf[512];
            std::snprintf(buf, sizeof(buf),
                "AUCTION CLOSED: \"%s\" | Winner: %s | "
                "Highest Bid: $%.2f | Settled Price (Vickrey): $%.2f | "
                "Total Bids: %d",
                a->title.c_str(), a->winnerName.c_str(),
                a->highestBid, a->settledPrice, a->totalBids);
            n.message          = std::string(buf);
            n.timestamp        = now;
            n.relatedAuctionId = auctionId;
            notifications.enqueue(n);

            std::cout << "  → Winner: " << a->winnerName
                      << " | Highest Bid: $" << a->highestBid
                      << " | Vickrey Price: $" << a->settledPrice
                      << " | Bids: " << a->totalBids << std::endl;
        }

        unlock();
    }

    // =====================================================================
    //  NOTIFICATIONS
    // =====================================================================

    std::vector<Notification> getNotifications() {
        lock();
        std::vector<Notification> result = notifications.toVector();
        unlock();
        return result;
    }

    // =====================================================================
    //  SEED DEMO DATA — pre-populates users, auctions, and bids for demo
    // =====================================================================

    void seedDemoData() {
        std::cout << "[SEED] Creating demo users...\n";
        createUser("Alice Johnson",  "alice@example.com");
        createUser("Bob Smith",      "bob@example.com");
        createUser("Charlie Brown",  "charlie@example.com");
        createUser("Diana Prince",   "diana@example.com");
        createUser("Ethan Hunt",     "ethan@example.com");

        std::cout << "[SEED] Creating demo auctions...\n";

        // Vehicle auctions matching Boli with 24-hour durations
        createAuction(
            "2021 Hyundai Creta 1.5 SX(O)",
            "Fuel: Petrol | Trans: Manual | 34,200 km | 1st Owner | RTO: MH12 Pune | Comprehensive Insurance | Zero Dep | 140-point inspection passed | Clean engine bay and transmission | Genuine service records",
            "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=800&auto=format&fit=crop",
            850000.00, 86400);

        createAuction(
            "2022 Royal Enfield Continental GT 650",
            "Fuel: Petrol | Trans: Manual | 8,400 km | 1st Owner | RTO: MH14 PCMC | Comprehensive Insurance | Twin Brembo brakes | Custom flyscreen & bar-end mirrors | Ceramic coated",
            "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=800&auto=format&fit=crop",
            240000.00, 86400);

        createAuction(
            "2020 Honda City 1.5 ZX CVT",
            "Fuel: Petrol | Trans: Automatic | 41,000 km | 1st Owner | RTO: MH02 Mumbai | Full Sunroof & Leather | Honda Care Extended Warranty | Non-accidental certified",
            "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800&auto=format&fit=crop",
            720000.00, 86400);

        createAuction(
            "2023 Kawasaki Ninja ZX-6R KRT",
            "Fuel: Petrol | Trans: Manual | 5,200 km | 1st Owner | RTO: DL03 Delhi | Showroom condition | Akrapovic slip-on exhaust | Quickshifter & traction control",
            "https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=800&auto=format&fit=crop",
            980000.00, 86400);

        createAuction(
            "2019 BMW 3 Series 320d Luxury Line",
            "Fuel: Diesel | Trans: Automatic | 52,000 km | 1st Owner | RTO: KA01 Bangalore | Harman Kardon audio | Panoramic sunroof | New Michelin Pilot Sport tyres",
            "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800&auto=format&fit=crop",
            1850000.00, 86400);

        createAuction(
            "2022 Tata Nexon EV Max XZ+ Lux",
            "Fuel: Electric | Trans: Automatic | 22,000 km | 1st Owner | RTO: GJ01 Ahmedabad | 405 km ARAI range | 7.2 kW Fast AC charger included | 8-year battery warranty",
            "https://images.unsplash.com/photo-1590362891991-f776e747a588?w=800&auto=format&fit=crop",
            1050000.00, 86400);

        std::cout << "[SEED] Placing initial demo bids...\n";

        placeBid(1, 2, 880000.00);   // Bob   → Creta
        placeBid(1, 4, 925000.00);   // Diana → Creta

        placeBid(2, 5, 255000.00);   // Ethan → Enfield
        placeBid(2, 2, 265000.00);   // Bob   → Enfield

        placeBid(3, 3, 740000.00);   // Charlie → Honda City
        placeBid(3, 4, 755000.00);   // Diana   → Honda City

        placeBid(4, 2, 1000000.00);  // Bob   → Ninja
        placeBid(4, 5, 1030000.00);  // Ethan → Ninja

        placeBid(5, 1, 1880000.00);  // Alice → BMW
        placeBid(5, 2, 1920000.00);  // Bob   → BMW

        placeBid(6, 4, 1075000.00);  // Diana → Nexon EV

        std::cout << "[SEED] Demo data ready! "
                  << users.size()    << " users, "
                  << auctions.size() << " auctions, "
                  << (nextBidId - 1) << " bids.\n\n";
    }
};

#endif // AUCTION_MANAGER_H
