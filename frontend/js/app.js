// ============================================
// BidMatrix — Application Logic
// ============================================

const API_BASE = ''; // same origin

// -------- State --------
let currentUserId = 1;
let currentUserName = 'Alice';
let auctions = [];
let notifications = [];
let lastNotificationCount = 0;
let selectedAuctionId = null;

// -------- DOM References --------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const userSelector = $('#user-selector');
const userAvatar = $('#user-avatar');
const notificationBell = $('#notification-bell');
const notificationPanel = $('#notification-panel');
const notificationCount = $('#notification-count');
const notificationTotal = $('#notification-total');
const notificationList = $('#notification-list');
const liveGrid = $('#live-auctions-grid');
const liveEmpty = $('#live-empty');
const liveCountBadge = $('#live-count');
const closedTbody = $('#closed-tbody');
const closedEmpty = $('#closed-empty');
const bidHistoryList = $('#bid-history-list');
const dashboardEmpty = $('#dashboard-empty');
const bidModal = $('#bid-modal');
const modalClose = $('#modal-close');
const modalCancel = $('#modal-cancel');
const modalSubmit = $('#modal-submit');
const modalTitle = $('#modal-auction-title');
const modalCurrentBid = $('#modal-current-bid');
const modalMinBid = $('#modal-min-bid');
const bidAmountInput = $('#bid-amount');
const bidError = $('#bid-error');
const createForm = $('#create-auction-form');
const toastContainer = $('#toast-container');

// -------- Tabs --------
const navTabs = $$('.nav-tab');
const sections = {
  live: $('#section-live'),
  closed: $('#section-closed'),
  dashboard: $('#section-dashboard'),
  create: $('#section-create'),
};

function switchTab(tabName) {
  navTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tabName));
  Object.entries(sections).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== tabName);
  });
  if (tabName === 'dashboard') loadDashboard();
  if (tabName === 'closed') loadClosedAuctions();
}

navTabs.forEach((tab) =>
  tab.addEventListener('click', () => switchTab(tab.dataset.tab))
);

// -------- Toast --------
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon =
    type === 'success'
      ? '✓'
      : type === 'error'
      ? '✕'
      : 'ℹ';
  toast.innerHTML = `<span class="text-lg">${icon}</span><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

// -------- Utilities --------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatCurrency(n) {
  return '$' + Number(n).toFixed(2);
}

function formatCountdown(seconds) {
  if (seconds <= 0) return 'CLOSED';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function timeAgo(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// -------- API Helpers --------
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  return res.json();
}

// -------- Users --------
async function loadUsers() {
  try {
    const data = await api('GET', '/api/users');
    const users = data.users || [];
    userSelector.innerHTML = '';
    users.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      if (u.id === currentUserId) opt.selected = true;
      userSelector.appendChild(opt);
    });
    updateAvatar();
  } catch (e) {
    console.warn('Could not load users', e);
  }
}

function updateAvatar() {
  const selected = userSelector.options[userSelector.selectedIndex];
  if (selected) {
    currentUserName = selected.textContent;
    userAvatar.textContent = currentUserName.charAt(0).toUpperCase();
  }
}

userSelector.addEventListener('change', () => {
  currentUserId = parseInt(userSelector.value, 10);
  updateAvatar();
  // Refresh dashboard if it's the current tab
  if (!sections.dashboard.classList.contains('hidden')) {
    loadDashboard();
  }
});

function setBackendStatus(online) {
  const pill = document.querySelector('#backend-status-pill');
  const dot = document.querySelector('#backend-status-dot');
  const text = document.querySelector('#backend-status-text');
  if (!pill) return;
  if (online) {
    pill.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    if (text) text.textContent = 'Backend Connected (C++)';
  } else {
    pill.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-semibold border border-rose-200';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-rose-500';
    if (text) text.textContent = 'Backend Disconnected';
  }
}

// -------- Auctions --------
async function loadAuctions() {
  try {
    const data = await api('GET', '/api/auctions');
    auctions = data.auctions || [];
    setBackendStatus(true);
    renderLiveAuctions();
  } catch (e) {
    setBackendStatus(false);
    console.warn('Could not load auctions', e);
  }
}

function renderLiveAuctions() {
  const now = Math.floor(Date.now() / 1000);
  const liveAuctions = auctions.filter((a) => a.isActive);

  liveCountBadge.textContent = liveAuctions.length;

  if (liveAuctions.length === 0) {
    // Clear cards but keep empty state
    liveGrid.querySelectorAll('.auction-card').forEach((c) => c.remove());
    liveEmpty.classList.remove('hidden');
    return;
  }

  liveEmpty.classList.add('hidden');

  // Build a map of existing cards for efficient updates
  const existingCards = {};
  liveGrid.querySelectorAll('.auction-card').forEach((card) => {
    existingCards[card.dataset.auctionId] = card;
  });

  const activeIds = new Set(liveAuctions.map((a) => String(a.id)));

  // Remove cards that are no longer live
  Object.keys(existingCards).forEach((id) => {
    if (!activeIds.has(id)) {
      existingCards[id].remove();
      delete existingCards[id];
    }
  });

  liveAuctions.forEach((auction) => {
    const remaining = auction.endTime - now;
    const cardHtml = buildAuctionCard(auction, remaining);

    if (existingCards[String(auction.id)]) {
      existingCards[String(auction.id)].outerHTML = cardHtml;
    } else {
      liveGrid.insertAdjacentHTML('beforeend', cardHtml);
    }
  });
}

function buildAuctionCard(auction, remaining) {
  const countdownClass =
    remaining <= 0
      ? 'closed'
      : remaining < 10
      ? 'danger'
      : remaining < 30
      ? 'warning'
      : '';
  const countdownText = formatCountdown(remaining);

  const imageSection = auction.imageUrl
    ? `<div class="card-image-placeholder h-44"><img src="${escapeHtml(auction.imageUrl)}" alt="${escapeHtml(auction.title)}" onerror="this.style.display='none'" loading="lazy" /></div>`
    : `<div class="card-image-placeholder h-44">
        <svg class="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"/></svg>
       </div>`;

  const isClosed = remaining <= 0;
  const bidBtnDisabled = isClosed ? 'disabled' : '';
  const bidBtnText = isClosed ? 'CLOSED' : 'Place Bid';

  return `
    <div class="auction-card" data-auction-id="${auction.id}">
      ${imageSection}
      <div class="p-4 space-y-3 flex-1 flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-2 mb-1">
            <h3 class="font-bold text-slate-900 text-sm leading-snug line-clamp-2">${escapeHtml(auction.title)}</h3>
            <span class="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-xs font-medium text-slate-600">
              <svg class="w-3 h-3 text-slate-400" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 11H9v-2h2v2Zm0-4H9V5h2v4Z"/></svg>
              ${auction.totalBids}
            </span>
          </div>
          ${auction.description ? `<p class="text-xs text-slate-500 line-clamp-2">${escapeHtml(auction.description)}</p>` : ''}
        </div>
        <div class="pt-2 border-t border-slate-100 space-y-3">
          <div class="flex items-end justify-between">
            <div>
              <p class="text-[11px] text-slate-400 font-medium">Current Bid</p>
              <p class="text-xl font-extrabold text-emerald-600">${formatCurrency(auction.currentHighestBid || auction.startingPrice)}</p>
              ${auction.highestBidderName ? `<p class="text-[11px] text-slate-500 mt-0.5">by <span class="font-semibold text-slate-700">${escapeHtml(auction.highestBidderName)}</span></p>` : '<p class="text-[11px] text-slate-400 mt-0.5">No bids yet</p>'}
            </div>
            <div class="text-right">
              <p class="text-[11px] text-slate-400 font-medium">Time Left</p>
              <p class="countdown text-base font-bold ${countdownClass}">${countdownText}</p>
            </div>
          </div>
          <button class="bid-button" ${bidBtnDisabled} onclick="openBidModal(${auction.id})">${bidBtnText}</button>
        </div>
      </div>
    </div>`;
}

// -------- Bid Modal --------
function openBidModal(auctionId) {
  const auction = auctions.find((a) => a.id === auctionId);
  if (!auction || !auction.isActive) return;

  selectedAuctionId = auctionId;
  const currentHigh = auction.currentHighestBid || auction.startingPrice;
  const minBid = currentHigh > 0 ? (Math.round((currentHigh + 0.01) * 100) / 100) : auction.startingPrice;

  modalTitle.textContent = auction.title;
  modalCurrentBid.textContent = formatCurrency(currentHigh);
  modalMinBid.textContent = formatCurrency(minBid);
  bidAmountInput.value = minBid.toFixed(2);
  bidAmountInput.min = minBid;
  bidError.classList.add('hidden');

  bidModal.classList.add('active');
  setTimeout(() => bidAmountInput.focus(), 100);
}

function closeBidModal() {
  bidModal.classList.remove('active');
  selectedAuctionId = null;
}

modalClose.addEventListener('click', closeBidModal);
modalCancel.addEventListener('click', closeBidModal);

// Close modal on overlay click
bidModal.addEventListener('click', (e) => {
  if (e.target === bidModal) closeBidModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bidModal.classList.contains('active')) {
    closeBidModal();
  }
});

modalSubmit.addEventListener('click', async () => {
  if (!selectedAuctionId) return;

  const amount = parseFloat(bidAmountInput.value);
  const auction = auctions.find((a) => a.id === selectedAuctionId);
  if (!auction) return;

  const currentHigh = auction.currentHighestBid || auction.startingPrice;
  if (isNaN(amount) || amount <= currentHigh) {
    bidError.textContent = `Bid must be higher than ${formatCurrency(currentHigh)}`;
    bidError.classList.remove('hidden');
    bidAmountInput.focus();
    return;
  }

  bidError.classList.add('hidden');
  modalSubmit.disabled = true;
  modalSubmit.textContent = 'Submitting...';

  try {
    const data = await api('POST', `/api/auctions/${selectedAuctionId}/bid`, {
      userId: currentUserId,
      amount: amount,
    });

    if (data.success) {
      showToast(data.message || 'Bid placed successfully!', 'success');
      closeBidModal();
      await loadAuctions();
    } else {
      showToast(data.error || 'Failed to place bid', 'error');
      bidError.textContent = data.error || 'Failed to place bid';
      bidError.classList.remove('hidden');
    }
  } catch (err) {
    showToast('Network error — please try again', 'error');
  } finally {
    modalSubmit.disabled = false;
    modalSubmit.textContent = 'Submit Bid';
  }
});

// Allow Enter key to submit bid
bidAmountInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    modalSubmit.click();
  }
});

// -------- Closed Auctions --------
async function loadClosedAuctions() {
  try {
    const data = await api('GET', '/api/closed');
    const closed = data.auctions || [];

    if (closed.length === 0) {
      closedTbody.innerHTML = '';
      closedEmpty.classList.remove('hidden');
      return;
    }

    closedEmpty.classList.add('hidden');
    closedTbody.innerHTML = closed
      .map(
        (a) => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td>
          <div class="flex items-center gap-3">
            ${
              a.imageUrl
                ? `<img src="${escapeHtml(a.imageUrl)}" class="w-10 h-10 rounded-lg object-cover border border-slate-200" onerror="this.style.display='none'" />`
                : `<div class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                    <svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909"/></svg>
                   </div>`
            }
            <div>
              <p class="font-semibold text-slate-900">${escapeHtml(a.title)}</p>
              ${a.description ? `<p class="text-xs text-slate-500 line-clamp-1">${escapeHtml(a.description)}</p>` : ''}
            </div>
          </div>
        </td>
        <td>
          <span class="font-semibold text-amber-700">${a.winnerName ? escapeHtml(a.winnerName) : '—'}</span>
        </td>
        <td class="text-emerald-700 font-bold">${formatCurrency(a.currentHighestBid)}</td>
        <td class="text-sky-700 font-bold">${a.settledPrice != null ? formatCurrency(a.settledPrice) : '—'}</td>
        <td><span class="px-2 py-0.5 rounded-full bg-slate-100 text-xs font-medium text-slate-600">${a.totalBids}</span></td>
        <td><span class="status-badge losing">Closed</span></td>
      </tr>`
      )
      .join('');
  } catch (e) {
    console.warn('Could not load closed auctions', e);
  }
}

// -------- Dashboard --------
async function loadDashboard() {
  try {
    const data = await api('GET', `/api/users/${currentUserId}`);
    const history = data.bidHistory || [];

    $('#stat-total-bids').textContent = data.totalBids || history.length;

    const winning = history.filter((b) => b.isWinning).length;
    const losing = history.length - winning;
    $('#stat-winning').textContent = winning;
    $('#stat-losing').textContent = losing;

    if (history.length === 0) {
      bidHistoryList.innerHTML = '';
      dashboardEmpty.classList.remove('hidden');
      return;
    }

    dashboardEmpty.classList.add('hidden');

    bidHistoryList.innerHTML = history
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(
        (bid) => `
      <div class="bid-history-row">
        <div class="flex-1">
          <p class="text-sm font-semibold text-slate-900">${escapeHtml(bid.auctionTitle || `Auction #${bid.auctionId}`)}</p>
          <p class="text-xs text-slate-500 mt-0.5">${timeAgo(bid.timestamp)}</p>
        </div>
        <div class="text-right mr-4">
          <p class="text-sm font-bold text-emerald-700">${formatCurrency(bid.amount)}</p>
        </div>
        <span class="status-badge ${bid.isWinning ? 'winning' : 'losing'}">${bid.isWinning ? 'Winning' : 'Outbid'}</span>
      </div>`
      )
      .join('');
  } catch (e) {
    console.warn('Could not load dashboard', e);
  }
}

// -------- Notifications --------
async function loadNotifications() {
  try {
    const data = await api('GET', '/api/notifications');
    notifications = data.notifications || [];
    renderNotifications();
  } catch (e) {
    console.warn('Could not load notifications', e);
  }
}

function renderNotifications() {
  const count = notifications.length;
  notificationTotal.textContent = `${count} event${count !== 1 ? 's' : ''}`;

  if (count > lastNotificationCount && lastNotificationCount > 0) {
    // New notifications arrived
    notificationCount.classList.remove('hidden');
    notificationCount.textContent = count - lastNotificationCount;
  }

  if (count === 0) {
    notificationList.innerHTML = `
      <div class="empty-state py-8">
        <svg class="w-10 h-10" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>
        <p class="text-sm mt-2">No notifications yet</p>
      </div>`;
    return;
  }

  notificationList.innerHTML = notifications
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(
      (n) => `
    <div class="notification-item">
      <div class="flex items-start gap-2.5">
        <div class="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0"></div>
        <div class="flex-1 min-w-0">
          <p class="text-xs text-slate-800 leading-snug font-medium">${escapeHtml(n.message)}</p>
          <p class="text-[10px] text-slate-400 mt-1">${timeAgo(n.timestamp)}</p>
        </div>
      </div>
    </div>`
    )
    .join('');

  lastNotificationCount = count;
}

// Toggle notification panel
notificationBell.addEventListener('click', (e) => {
  e.stopPropagation();
  const isActive = notificationPanel.classList.toggle('active');
  if (isActive) {
    notificationCount.classList.add('hidden');
    notificationCount.textContent = '0';
  }
});

// Close notification panel on outside click
document.addEventListener('click', (e) => {
  if (
    notificationPanel.classList.contains('active') &&
    !$('#notification-wrapper').contains(e.target)
  ) {
    notificationPanel.classList.remove('active');
  }
});

// -------- Create Auction --------
createForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = $('#auction-title').value.trim();
  const description = $('#auction-description').value.trim();
  const imageUrl = $('#auction-image').value.trim();
  const startingPrice = parseFloat($('#auction-price').value);
  const durationSeconds = parseInt($('#auction-duration').value, 10);

  if (!title || !description || isNaN(startingPrice) || isNaN(durationSeconds)) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  const submitBtn = createForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const data = await api('POST', '/api/auctions', {
      title,
      description,
      imageUrl: imageUrl || '',
      startingPrice,
      durationSeconds,
    });

    if (data.success) {
      showToast('Auction created successfully!', 'success');
      createForm.reset();
      await loadAuctions();
      switchTab('live');
    } else {
      showToast(data.error || 'Failed to create auction', 'error');
    }
  } catch (err) {
    showToast('Network error — please try again', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// -------- Countdown Timer Updater --------
// Runs every second to update timers without full re-render
function updateCountdowns() {
  const now = Math.floor(Date.now() / 1000);
  liveGrid.querySelectorAll('.auction-card').forEach((card) => {
    const auctionId = parseInt(card.dataset.auctionId, 10);
    const auction = auctions.find((a) => a.id === auctionId);
    if (!auction) return;

    const remaining = auction.endTime - now;
    const countdownEl = card.querySelector('.countdown');
    if (!countdownEl) return;

    countdownEl.textContent = formatCountdown(remaining);

    // Update classes
    countdownEl.classList.remove('warning', 'danger', 'closed');
    if (remaining <= 0) {
      countdownEl.classList.add('closed');
      // Disable the bid button
      const btn = card.querySelector('.bid-button');
      if (btn && !btn.disabled) {
        btn.disabled = true;
        btn.textContent = 'CLOSED';
      }
    } else if (remaining < 10) {
      countdownEl.classList.add('danger');
    } else if (remaining < 30) {
      countdownEl.classList.add('warning');
    }
  });
}

// -------- Polling --------
let auctionPollInterval = null;
let notificationPollInterval = null;
let countdownInterval = null;

function startPolling() {
  // Poll auctions every 3 seconds
  auctionPollInterval = setInterval(loadAuctions, 3000);

  // Poll notifications every 5 seconds
  notificationPollInterval = setInterval(loadNotifications, 5000);

  // Update countdowns every second
  countdownInterval = setInterval(updateCountdowns, 1000);
}

// -------- Initialization --------
async function init() {
  await loadUsers();
  await loadAuctions();
  await loadNotifications();
  startPolling();
}

// Start the app
init();
