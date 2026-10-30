# BidMatrix — Real-Time Auction System

A high-performance real-time Vickrey second-price auction system built in modern C++ with an in-memory Binary Search Tree (BST) architecture, self-contained Winsock HTTP server, and a clean web frontend.

---

## 🚀 Key Features

- **In-Memory Data Structures (C++):**
  - **Max-BST (Per Auction):** Real-time bid storage and $O(\log n)$ retrieval of current highest bid.
  - **Min-BST (Global Expiry):** Automated auction termination checking the earliest expiring item in $O(1)$ without linear scans.
  - **Linked List:** User bidding history with fast prepend operations.
  - **Queue:** Dynamic FIFO live notification feed.
- **Vickrey Auction Mechanism (Second-Price):**
  - The highest bidder wins, but pays the second-highest submitted bid price, incentivizing truthful bidding.
- **Background Expiry Engine:**
  - Dedicated background thread continuously checks for expired auctions every second and closes them automatically.
- **Embedded Winsock HTTP/1.1 Server:**
  - Zero third-party runtime dependencies. Implements routing, static file serving, parameter parsing, and CORS headers.
- **Clean Modern Frontend:**
  - Minimalist white UI built with responsive layout, live countdown timers, toast alerts, user switching, and quick bidding modals.

---

## 🛠️ Project Structure

```
├── backend/
│   ├── include/
│   │   ├── auction_manager.h    # Core business logic and threading
│   │   ├── bst.h                # Binary Search Tree implementation
│   │   ├── http_server.h        # Winsock HTTP/1.1 web server
│   │   ├── json_util.h          # Minimal JSON serializer/deserializer
│   │   ├── linked_list.h        # Singly linked list for user bid history
│   │   ├── queue.h              # Notification queue
│   │   └── models.h             # Data models (Auction, User, Bid, etc.)
│   ├── src/
│   │   └── main.cpp             # API routes & server entrypoint
│   ├── build.bat                # Windows build script (g++ / MinGW)
│   └── Makefile                 # Linux/GCC makefile
├── frontend/
│   ├── index.html               # Single Page Application
│   ├── css/styles.css           # Clean light theme styling
│   └── js/app.js                # Live polling & UI state management
└── README.md
```

---

## ⚙️ How to Build and Run

### Windows (MinGW / g++)
```cmd
cd backend
build.bat run
```
Or directly from the root:
```cmd
g++ -std=c++14 -O2 -I backend/include -o bidmatrix.exe backend/src/main.cpp -lws2_32
.\bidmatrix.exe
```

Access the UI at: **http://localhost:8080**
