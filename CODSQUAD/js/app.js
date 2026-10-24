import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseConfigured } from './config.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  supabase: null, user: null, profile: null, page: 'dashboard', members: [],
  activeConversationId: null, activeConversation: null, groupConversationId: null,
  conversationList: [], presenceIds: new Set(), globalChannel: null,
  presenceChannel: null, chatChannel: null, avatarCache: new Map(), activeChatKind: 'group',
  settingsTab: 'profile', searchTimer: null, messagesLoading: false, enteringUserId: null, enterPromise: null
};
const PAGE_NAMES = {
  dashboard: 'Overview', members: 'Squad members', gaming: 'Gaming lounge', sessions: 'Play sessions',
  'group-chat': 'Squad chat', 'private-chat': 'Direct messages', announcements: 'Announcements',
  activity: 'Activity feed', notifications: 'Notifications', settings: 'Settings', admin: 'Admin desk'
};

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function escapeAttr(value = '') { return escapeHTML(value).replace(/`/g, '&#96;'); }
function initials(profile) {
  const name = profile?.display_name || profile?.username || 'C';
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}
function icon(name, fallback = '✳') { return `<i data-lucide="${escapeAttr(name)}" aria-hidden="true"></i>`; }
function refreshIcons() { if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } }); }
function setConnection(kind, label) {
  const el = $('#connection-state'); if (!el) return;
  el.className = `connection-state ${kind || ''}`;
  el.innerHTML = `<span class="connection-dot"></span><span>${escapeHTML(label)}</span>`;
}
function showAuthMessage(message = '', kind = 'error') {
  const el = $('#auth-error'); if (!el) return;
  el.className = `form-message ${kind === 'success' ? 'success-message' : 'error-message'}`;
  el.textContent = message;
}
function toast(title, message = '', kind = 'success') {
  const region = $('#toast-region');
  const node = document.createElement('div'); node.className = `toast ${kind === 'error' ? 'error' : ''}`;
  node.innerHTML = `<div class="toast-icon">${icon(kind === 'error' ? 'alert-circle' : 'check-circle-2')}</div><div class="toast-copy"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p></div><button class="toast-close" aria-label="Dismiss">${icon('x')}</button>`;
  $('.toast-close', node).addEventListener('click', () => node.remove()); region.append(node); refreshIcons();
  window.setTimeout(() => node.remove(), 5200);
}
function formatDate(value, options = { month: 'short', day: 'numeric' }) {
  if (!value) return '—'; const date = new Date(value); if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, options).format(date);
}
function formatTime(value) {
  if (!value) return '';
  const date = new Date(value); if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return formatDate(value, { month: 'short', day: 'numeric' });
}
function relativeTime(value) {
  if (!value) return 'Just now';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(value);
}
function cleanError(error, fallback = 'Something went wrong. Please try again.') {
  const message = error?.message || fallback;
  if (/row-level security|permission denied|not allowed/i.test(message)) return 'You do not have permission for that action. Check the Supabase setup and access policies.';
  if (/failed to fetch|networkerror|fetch failed/i.test(message)) return 'Could not reach Supabase. Check your internet connection and project URL.';
  return message;
}
function setPageLoading(message = 'Loading your space…') {
  $('#page-content').innerHTML = `<div class="page-loading"><span class="spinner"></span><span>${escapeHTML(message)}</span></div>`;
}
function pageHeading(kicker, title, description, actions = '') {
  return `<div class="page-heading"><div><div class="page-kicker">${escapeHTML(kicker)}</div><h1 class="page-title">${title}</h1><p class="page-description">${escapeHTML(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}
function emptyState(iconName, title, description, action = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon(iconName)}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p>${action}</div>`;
}
function avatarFallback(p, cssClass = 'avatar') { return `<span class="${cssClass}" aria-label="${escapeAttr(p?.display_name || 'Member')}">${escapeHTML(initials(p))}</span>`; }
async function avatarHTML(p, cssClass = 'avatar') {
  if (!p) return avatarFallback(p, cssClass);
  let signed = '';
  if (p.avatar_path && state.supabase) {
    const cached = state.avatarCache.get(p.avatar_path);
    if (cached && cached.until > Date.now()) signed = cached.url;
    else {
      const { data, error } = await state.supabase.storage.from('codsquad-media').createSignedUrl(p.avatar_path, 3600);
      if (!error && data?.signedUrl) { signed = data.signedUrl; state.avatarCache.set(p.avatar_path, { url: signed, until: Date.now() + 3300000 }); }
    }
  }
  if (!signed) return avatarFallback(p, cssClass);
  return `<span class="${cssClass}"><img src="${escapeAttr(signed)}" alt="${escapeAttr(p.display_name || 'Member')}" loading="lazy"></span>`;
}
function pill(text, kind = 'gray') { return `<span class="pill ${kind}">${escapeHTML(text)}</span>`; }
function memberOnline(p) { return state.presenceIds.has(p?.id); }
function avatarStackHTML(members, max = 4) {
  const shown = members.slice(0, max);
  return `<div class="avatar-stack">${shown.map(p => avatarFallback(p, 'avatar avatar-sm')).join('')}${members.length > max ? `<span class="avatar-placeholder">+${members.length - max}</span>` : ''}</div>`;
}
async function fetchMembers() {
  const { data, error } = await state.supabase.from('profiles')
    .select('id,username,display_name,bio,avatar_path,favorite_games,gaming_status,role,is_authorized,created_at')
    .eq('is_authorized', true).order('display_name', { ascending: true });
  if (error) throw error;
  state.members = data || []; return state.members;
}
async function logActivity(eventType, title, detail = '', entityId = null) {
  const { error } = await state.supabase.from('activity_logs').insert({ actor_id: state.user.id, event_type: eventType, title, detail, entity_id: entityId });
  if (error) console.warn('Activity log could not be recorded:', error.message);
}
function navigate(page, { replace = false } = {}) {
  if (!PAGE_NAMES[page] || (page === 'admin' && state.profile?.role !== 'admin')) page = 'dashboard';
  state.page = page;
  $$('.nav-link[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#topbar-page').textContent = PAGE_NAMES[page] || 'Overview';
  $('#sidebar').classList.remove('open');
  if (!replace && location.hash !== `#${page}`) history.pushState({ page }, '', `#${page}`);
  renderPage();
}
function updateCurrentUserUI() {
  if (!state.profile) return;
  const displayName = state.profile.display_name || state.profile.username || 'Squad member';
  $('#current-name').textContent = displayName; $('#current-role').textContent = state.profile.role === 'admin' ? 'SQUAD ADMIN' : 'SQUAD MEMBER';
  $('#current-avatar').textContent = initials(state.profile); $('#topbar-avatar').textContent = initials(state.profile);
  $('#admin-nav').classList.toggle('hidden', state.profile.role !== 'admin');
  updateHeaderAvatars();
}
async function updateHeaderAvatars() {
  if (!state.profile) return;
  const markup = await avatarHTML(state.profile, 'avatar');
  const holder = document.createElement('div'); holder.innerHTML = markup; const img = holder.querySelector('img');
  for (const el of [$('#current-avatar'), $('#topbar-avatar')]) {
    if (!el) continue;
    if (img) el.innerHTML = `<img src="${escapeAttr(img.src)}" alt="${escapeAttr(state.profile.display_name || 'Your profile')}" loading="lazy">`;
    else el.textContent = initials(state.profile);
  }
}
function updateSidebarPresence() {
  $('#sidebar-member-count').textContent = `${state.members.length || '—'} / 4`;
  const online = state.members.filter(memberOnline).length;
  $('#sidebar-online-count').textContent = `${online} online right now`;
  const host = $('#sidebar-avatars');
  if (host && state.members.length) host.innerHTML = state.members.slice(0, 4).map(p => avatarFallback(p, 'avatar avatar-sm')).join('');
}
function showApp() {
  $('#auth-screen').classList.add('hidden'); $('#app-shell').classList.remove('hidden');
  updateCurrentUserUI(); refreshIcons();
}
function showLogin() {
  $('#app-shell').classList.add('hidden'); $('#auth-screen').classList.remove('hidden');
  refreshIcons();
}
async function stopChannels() {
  for (const key of ['chatChannel', 'globalChannel', 'presenceChannel']) {
    if (state[key] && state.supabase) await state.supabase.removeChannel(state[key]);
    state[key] = null;
  }
}
function enterApp(session) {
  if (!session?.user || !state.supabase) return Promise.resolve();
  if (state.profile && state.user?.id === session.user.id) return Promise.resolve();
  if (state.enterPromise && state.enteringUserId === session.user.id) return state.enterPromise;
  state.enteringUserId = session.user.id;
  state.enterPromise = enterAppInternal(session).finally(() => {
    if (state.enteringUserId === session.user.id) { state.enteringUserId = null; state.enterPromise = null; }
  });
  return state.enterPromise;
}
async function enterAppInternal(session) {
  if (!session?.user || !state.supabase) return;
  state.user = session.user; setConnection('', 'Checking access');
  try {
    const { data: profile, error } = await state.supabase.from('profiles')
      .select('id,username,display_name,bio,avatar_path,favorite_games,gaming_status,role,is_authorized,created_at')
      .eq('id', state.user.id).maybeSingle();
    if (error) throw error;
    if (!profile?.is_authorized) {
      showLogin(); showAuthMessage('This account is not on the CODSQUAD access list yet. Ask the squad admin to authorize it.', 'error');
      await state.supabase.auth.signOut(); return;
    }
    state.profile = profile; state.avatarCache.clear();
    await fetchMembers();
    const { data: groupId, error: groupError } = await state.supabase.rpc('ensure_group_conversation');
    if (groupError) throw groupError;
    state.groupConversationId = groupId;
    showApp(); setConnection('', 'Connecting realtime'); updateSidebarPresence();
    await startRealtime(); await refreshBadges();
    const requested = location.hash.replace(/^#/, '');
    navigate(PAGE_NAMES[requested] && (requested !== 'admin' || profile.role === 'admin') ? requested : 'dashboard', { replace: true });
  } catch (error) {
    console.error(error); showLogin();
    showAuthMessage(`Could not finish signing in: ${cleanError(error)}`);
    setConnection('error', 'Connection issue');
  }
}
async function startRealtime() {
  await stopChannels();
  const { data: savedSettings } = await state.supabase.from('user_settings').select('presence_visible').eq('user_id', state.user.id).maybeSingle();
  const presenceAllowed = savedSettings?.presence_visible !== false;
  const presence = state.supabase.channel('codsquad-presence', { config: { private: true, presence: { key: state.user.id } } });
  presence.on('presence', { event: 'sync' }, () => {
    const presenceState = presence.presenceState();
    state.presenceIds = new Set(Object.values(presenceState).flat().map(item => item.user_id).filter(Boolean));
    updateSidebarPresence();
    $$('.presence-indicator[data-user-id]').forEach(el => {
      const online = state.presenceIds.has(el.dataset.userId); el.classList.toggle('online', online); el.title = online ? 'Online now' : 'Offline';
    });
    $$('.member-online-text[data-user-id]').forEach(el => { el.textContent = state.presenceIds.has(el.dataset.userId) ? 'Online now' : 'Offline'; });
  });
  presence.subscribe(async status => {
    if (status === 'SUBSCRIBED' && presenceAllowed) {
      try { await presence.track({ user_id: state.user.id, display_name: state.profile.display_name, online_at: new Date().toISOString() }); }
      catch (error) { console.warn('Presence tracking unavailable:', error.message); }
    }
  });
  state.presenceChannel = presence;
  const global = state.supabase.channel(`codsquad-live-${state.user.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${state.user.id}` }, () => refreshBadges())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (payload.new.sender_id !== state.user.id) refreshBadges();
      if ((state.page === 'group-chat' || state.page === 'private-chat') && payload.new.conversation_id === state.activeConversationId) debouncedReloadMessages();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => { if (state.page === 'dashboard' || state.page === 'announcements') renderPage(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gaming_sessions' }, () => { if (state.page === 'dashboard' || state.page === 'sessions' || state.page === 'gaming') renderPage(); });
  global.subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('error', 'Realtime reconnecting'); else if (status === 'SUBSCRIBED') setConnection('connected', 'Squad connected'); });
  state.globalChannel = global;
}
let reloadTimer;
function debouncedReloadMessages() { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => loadChatMessages(), 180); }
async function refreshBadges() {
  if (!state.user || !state.supabase) return;
  try {
    const [notices, memberships, settings] = await Promise.all([
      state.supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', state.user.id).is('read_at', null),
      state.supabase.from('conversation_members').select('conversation_id,last_read_at,conversation:conversations!conversation_members_conversation_id_fkey(kind)').eq('user_id', state.user.id),
      state.supabase.from('user_settings').select('notifications_enabled').eq('user_id',state.user.id).maybeSingle()
    ]);
    const count = settings.data?.notifications_enabled === false ? 0 : (notices.count || 0);
    $('#notification-badge').textContent = count; $('#notification-badge').classList.toggle('hidden', count === 0);
    $('#topbar-notification-dot').classList.toggle('hidden', count === 0);
    const rows = memberships.data || []; let groupUnread = 0, dmUnread = 0;
    for (const membership of rows) {
      let query = state.supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', membership.conversation_id).neq('sender_id', state.user.id);
      if (membership.last_read_at) query = query.gt('created_at', membership.last_read_at);
      const result = await query; const unreadCount = result.count || 0;
      if (membership.conversation?.kind === 'group') groupUnread += unreadCount; else dmUnread += unreadCount;
    }
    $('#group-unread-badge').textContent = groupUnread; $('#group-unread-badge').classList.toggle('hidden', groupUnread === 0);
    $('#dm-unread-badge').textContent = dmUnread; $('#dm-unread-badge').classList.toggle('hidden', dmUnread === 0);
  } catch (error) { console.warn('Badge refresh failed:', error.message); }
}

async function renderPage() {
  if (!state.user || !state.profile) return;
  setPageLoading();
  try {
    let html;
    switch (state.page) {
      case 'dashboard': html = await renderDashboard(); break;
      case 'members': html = await renderMembers(); break;
      case 'gaming': html = await renderGaming(); break;
      case 'sessions': html = await renderSessions(); break;
      case 'group-chat': html = await renderChat('group'); break;
      case 'private-chat': html = await renderChat('private'); break;
      case 'announcements': html = await renderAnnouncements(); break;
      case 'activity': html = await renderActivity(); break;
      case 'notifications': html = await renderNotifications(); break;
      case 'settings': html = await renderSettings(); break;
      case 'admin': html = await renderAdmin(); break;
      default: html = renderNotFound();
    }
    if (state.page && $('#page-content')) $('#page-content').innerHTML = html;
    refreshIcons(); bindPageActions();
    if (state.page === 'group-chat' || state.page === 'private-chat') {
      const messageEl = $('#chat-messages'); if (messageEl) messageEl.scrollTop = messageEl.scrollHeight;
    }
  } catch (error) {
    console.error(error); $('#page-content').innerHTML = `<div class="surface">${emptyState('cloud-off', 'Could not load this page', cleanError(error), '<button class="secondary-button" data-action="retry-page">Try again</button>')}</div>`; refreshIcons();
    if (/fetch|network|project URL/i.test(cleanError(error))) setConnection('error', 'Connection issue');
  }
}

async function renderDashboard() {
  const [members, sessionsResult, announcementsResult, activityResult, messagesResult, upcomingCountResult] = await Promise.all([
    fetchMembers(),
    state.supabase.from('gaming_sessions').select('id,title,game_name,description,scheduled_at,status,created_by').in('status', ['scheduled','open']).gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(3),
    state.supabase.from('announcements').select('id,title,content,is_pinned,created_at,author:profiles!announcements_author_id_fkey(display_name)').order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(3),
    state.supabase.from('activity_logs').select('id,event_type,title,detail,created_at,actor:profiles!activity_logs_actor_id_fkey(display_name)').order('created_at', { ascending: false }).limit(4),
    state.groupConversationId ? state.supabase.from('messages').select('id,body,created_at,sender_id,sender:profiles!messages_sender_id_fkey(display_name)').eq('conversation_id', state.groupConversationId).order('created_at', { ascending: false }).limit(3) : Promise.resolve({ data: [] }),
    state.supabase.from('gaming_sessions').select('id', { count: 'exact', head: true }).in('status', ['scheduled','open']).gte('scheduled_at', new Date().toISOString())
  ]);
  for (const res of [sessionsResult, announcementsResult, activityResult, messagesResult, upcomingCountResult]) if (res?.error) throw res.error;
  const sessions = sessionsResult.data || [], announcements = announcementsResult.data || [], activities = activityResult.data || [], messages = (messagesResult.data || []).reverse();
  const online = members.filter(memberOnline).length;
  const upcoming = sessions[0];
  const upcomingTotal = upcomingCountResult.count || 0;
  const sessionContent = sessions.length ? sessions.map(s => `<div class="list-row"><div class="game-symbol">${icon('gamepad-2')}</div><div class="list-row-copy"><strong>${escapeHTML(s.title)}</strong><small>${escapeHTML(s.game_name)} · ${formatDate(s.scheduled_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></div><button class="button-quiet" data-action="view-sessions" aria-label="View sessions">${icon('arrow-up-right')}</button></div>`).join('') : emptyState('calendar-clock', 'No sessions queued', 'Set up the next squad run and get everyone in one place.', '<button class="secondary-button button-small" data-action="new-session">Plan a session</button>');
  const memberContent = members.map(async p => `<div class="member-row">${await avatarHTML(p, 'avatar')}<div class="member-row-copy"><strong>${escapeHTML(p.display_name)}</strong><small>@${escapeHTML(p.username || 'squad-member')}</small></div><span class="pill ${memberOnline(p) ? 'lime' : 'gray'}"><span class="live-small" style="${memberOnline(p) ? '' : 'background:#657063'}"></span>${memberOnline(p) ? 'Online' : 'Offline'}</span></div>`);
  const memberRows = (await Promise.all(memberContent)).join('');
  const chatPreview = messages.length ? messages.map(m => `<div class="activity-item"><div class="activity-icon">${icon(m.sender_id === state.user.id ? 'send' : 'message-circle')}</div><div class="activity-copy"><p><strong>${escapeHTML(m.sender?.display_name || 'Member')}:</strong> ${escapeHTML((m.body || 'Shared an image').slice(0, 100))}</p><time>${relativeTime(m.created_at)}</time></div></div>`).join('') : emptyState('messages-square', 'The chat is quiet', 'Drop the first message in the squad room.', '<button class="secondary-button button-small" data-action="open-group-chat">Open squad chat</button>');
  const announcementContent = announcements.length ? announcements.map(a => `<div class="list-row"><div class="activity-icon">${icon(a.is_pinned ? 'pin' : 'megaphone')}</div><div class="list-row-copy"><strong>${escapeHTML(a.title)}</strong><small>${escapeHTML(a.author?.display_name || 'Squad admin')} · ${relativeTime(a.created_at)}</small></div>${a.is_pinned ? pill('PINNED','lime') : ''}</div>`).join('') : emptyState('megaphone', 'No announcements yet', 'Squad updates will show up here.');
  const activitiesContent = activities.length ? activities.map(a => `<div class="activity-item"><div class="activity-icon">${icon(a.event_type === 'session' ? 'gamepad-2' : a.event_type === 'announcement' ? 'megaphone' : 'activity')}</div><div class="activity-copy"><p><strong>${escapeHTML(a.actor?.display_name || 'Squad member')}</strong> ${escapeHTML(a.title || a.detail || 'updated the squad')}</p><time>${relativeTime(a.created_at)}</time></div></div>`).join('') : emptyState('activity', 'Nothing happening yet', 'Activity will appear as the squad gets moving.');
  const todayKicker = new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric'}).format(new Date()).toUpperCase();
  return `${pageHeading(todayKicker, `Hey, ${escapeHTML((state.profile.display_name || 'Player').split(' ')[0])}. <span class="lime-text">You made it.</span>`, 'Your private corner of the internet. Catch up with the squad and line up your next session.', '<button class="secondary-button" data-action="open-group-chat">'+icon('messages-square')+' Squad chat</button><button class="primary-button" data-action="new-session">'+icon('plus')+' Plan a session</button>')}
    <section class="welcome-banner"><div class="welcome-copy"><div class="page-kicker"><span class="live-pip"></span> PRIVATE SQUAD SPACE</div><h2>Four players.<br><span>One squad.</span> Infinite possibilities.</h2><p>Keep the banter flowing, make plans, and stay in sync with your inner circle. Everything in one place, just for the four of you.</p><div class="welcome-actions"><button class="primary-button" data-action="open-group-chat">${icon('messages-square')} Jump into chat</button><button class="secondary-button" data-page="members">Meet the squad ${icon('arrow-up-right')}</button></div></div><div class="welcome-art" aria-hidden="true">${icon('gamepad-2')}</div></section>
    <div class="grid-4" style="margin-top:16px"><article class="surface stat-card"><div class="stat-top"><span>Squad members</span><span class="stat-icon">${icon('users')}</span></div><div class="stat-value">${members.length}<span style="color:#6d7b67;font-size:16px"> / 4</span></div><div class="stat-sub">Your trusted inner circle</div></article><article class="surface stat-card"><div class="stat-top"><span>Online right now</span><span class="stat-icon">${icon('radio-tower')}</span></div><div class="stat-value">${online}</div><div class="stat-sub">Based on live presence</div></article><article class="surface stat-card"><div class="stat-top"><span>Upcoming sessions</span><span class="stat-icon">${icon('calendar-days')}</span></div><div class="stat-value">${upcomingTotal}</div><div class="stat-sub">${upcoming ? `Next: ${escapeHTML(upcoming.game_name)}` : 'No plans on the calendar'}</div></article><article class="surface stat-card"><div class="stat-top"><span>Unread notifications</span><span class="stat-icon">${icon('bell')}</span></div><div class="stat-value" id="dashboard-unread">—</div><div class="stat-sub">Little things you may have missed</div></article></div>
    <div class="dashboard-lower"><div style="display:grid;gap:16px;align-content:start"><section class="surface"><div class="surface-header"><div><h2 class="surface-title">The squad</h2><p class="surface-subtitle">The people who make it a team</p></div><button class="inline-link button-quiet" data-page="members">All members ${icon('arrow-up-right')}</button></div><div class="surface-body" style="padding-top:5px;padding-bottom:5px">${memberRows || emptyState('users','No squad members','Once members are authorized, they will show here.')}</div></section><section class="surface"><div class="surface-header"><div><h2 class="surface-title">Next on the calendar</h2><p class="surface-subtitle">Upcoming squad sessions</p></div><button class="inline-link button-quiet" data-page="sessions">View all ${icon('arrow-up-right')}</button></div><div class="surface-body" style="padding-top:4px;padding-bottom:4px">${sessionContent}</div></section></div><div style="display:grid;gap:16px;align-content:start"><section class="surface"><div class="surface-header"><div><h2 class="surface-title">Recent squad chat</h2><p class="surface-subtitle">Latest from your group</p></div><button class="icon-button" data-action="open-group-chat" aria-label="Open squad chat">${icon('arrow-up-right')}</button></div><div class="surface-body">${chatPreview}</div></section><section class="surface"><div class="surface-header"><div><h2 class="surface-title">Announcements</h2><p class="surface-subtitle">What the squad should know</p></div><button class="inline-link button-quiet" data-page="announcements">See all ${icon('arrow-up-right')}</button></div><div class="surface-body" style="padding-top:4px;padding-bottom:4px">${announcementContent}</div></section><section class="surface"><div class="surface-header"><div><h2 class="surface-title">Activity</h2><p class="surface-subtitle">A little life in the squad</p></div><button class="icon-button" data-page="activity" aria-label="View activity">${icon('arrow-up-right')}</button></div><div class="surface-body">${activitiesContent}</div></section></div></div>`;
}

async function renderMembers(filter = '') {
  const members = await fetchMembers(); const term = filter.trim().toLowerCase();
  const filtered = members.filter(p => [p.display_name, p.username, p.bio, ...(p.favorite_games || [])].some(v => String(v || '').toLowerCase().includes(term)));
  const cards = await Promise.all(filtered.map(async p => {
    const favs = (p.favorite_games || []).slice(0, 3).map(game => `<span class="tag">${escapeHTML(game)}</span>`).join('');
    const online = memberOnline(p);
    return `<article class="surface member-card"><div class="member-card-top">${await avatarHTML(p, 'avatar member-big-avatar')}<span class="pill ${online ? 'lime' : 'gray'}"><span class="live-small" style="${online ? '' : 'background:#657063'}"></span><span class="member-online-text" data-user-id="${p.id}">${online ? 'Online now' : 'Offline'}</span></span></div><h3>${escapeHTML(p.display_name)}</h3><div class="username">@${escapeHTML(p.username || 'squad-member')}${p.role === 'admin' ? ` · <span style="color:var(--lime)">ADMIN</span>` : ''}</div><p class="member-bio">${escapeHTML(p.bio || 'No bio yet — this player is letting the game do the talking.')}</p><div class="tag-row">${favs || '<span class="tag">Game preferences not set</span>'}</div><div class="member-card-actions"><button class="secondary-button button-small" data-action="view-profile" data-user-id="${p.id}">${icon('user-round')} Profile</button>${p.id !== state.user.id ? `<button class="primary-button button-small" data-action="start-dm" data-user-id="${p.id}">${icon('message-circle')} Message</button>` : `<button class="secondary-button button-small" data-page="settings">${icon('settings-2')} Edit yours</button>`}</div></article>`;
  }));
  return `${pageHeading('THE INNER CIRCLE','Squad members','Four players who turn an ordinary session into a story. Only authorized members appear here.',`<div class="search-field">${icon('search')}<input id="member-search" type="search" placeholder="Find a squad member…" value="${escapeAttr(filter)}" aria-label="Search squad members"></div>`)}<div id="member-results" class="member-grid">${cards.join('') || emptyState('users','No members found',term ? 'Try a different name or favorite game.' : 'No authorized members have been set up yet.')}</div>`;
}
async function renderGaming() {
  const members = await fetchMembers();
  const roster = await Promise.all(members.map(async p => `<div class="member-row">${await avatarHTML(p, 'avatar')}<div class="member-row-copy"><strong>${escapeHTML(p.display_name)}</strong><small>@${escapeHTML(p.username || 'squad-member')}</small></div><span class="pill ${p.gaming_status === 'available' ? 'lime' : p.gaming_status === 'busy' ? 'amber' : 'gray'}">${escapeHTML((p.gaming_status || 'offline').replace(/^./, c => c.toUpperCase()))}</span>${p.id === state.user.id ? `<button class="button-quiet" data-action="edit-status" aria-label="Change your status">${icon('pencil')}</button>` : ''}</div>`));
  const games = [...new Set(members.flatMap(p => p.favorite_games || []))];
  return `${pageHeading('PLAY TOGETHER','Gaming lounge','The lobby before the lobby. See who is around, share what you play, and plan the next run.',`<button class="primary-button" data-action="new-session">${icon('plus')} Schedule a game</button>`)}<div class="grid-2"><section class="surface"><div class="surface-header"><div><h2 class="surface-title">Who is around?</h2><p class="surface-subtitle">Live gaming status for your four</p></div>${pill(`${state.presenceIds.size} online`,'lime')}</div><div class="surface-body" style="padding-top:5px;padding-bottom:5px">${roster.join('') || emptyState('users','No members yet','The squad will appear once accounts are authorized.')}</div></section><section class="surface"><div class="surface-header"><div><h2 class="surface-title">Games in the rotation</h2><p class="surface-subtitle">Pulled from squad member preferences</p></div>${icon('gamepad-2')}</div><div class="surface-body"><div class="tag-row">${games.map(game => `<span class="tag">${escapeHTML(game)}</span>`).join('') || '<span class="muted">No favorite games added yet.</span>'}</div><div class="divider-label">YOUR PLAY STATUS</div><form id="gaming-status-form" class="modal-form"><div class="field-group"><label class="field-label" for="gaming-status">Current status</label><select class="field-select" id="gaming-status" name="gaming_status"><option value="offline" ${state.profile.gaming_status === 'offline' ? 'selected' : ''}>Offline</option><option value="available" ${state.profile.gaming_status === 'available' ? 'selected' : ''}>Available to play</option><option value="playing" ${state.profile.gaming_status === 'playing' ? 'selected' : ''}>Currently playing</option><option value="busy" ${state.profile.gaming_status === 'busy' ? 'selected' : ''}>Busy</option></select></div><button class="primary-button" type="submit">Save gaming status ${icon('check')}</button></form></div></section></div><section class="surface" style="margin-top:18px"><div class="surface-header"><div><h2 class="surface-title">Pick a game. Make a memory.</h2><p class="surface-subtitle">Get a session on the calendar so nobody misses the invite.</p></div><button class="secondary-button button-small" data-page="sessions">View sessions ${icon('arrow-up-right')}</button></div><div class="surface-body"><div class="grid-3"><article class="session-card" style="min-height:154px"><div class="game-symbol">${icon('calendar-plus')}</div><h3>Plan the next run</h3><div class="session-game">Choose a game, time, and squad.</div><div class="session-card-footer"><span class="muted" style="font-size:10px">Set it up in seconds</span><button class="inline-link button-quiet" data-action="new-session">Create ${icon('arrow-up-right')}</button></div></article><article class="session-card" style="min-height:154px"><div class="game-symbol">${icon('messages-square')}</div><h3>Get everyone talking</h3><div class="session-game">Settle the loadout in squad chat.</div><div class="session-card-footer"><span class="muted" style="font-size:10px">Group conversation</span><button class="inline-link button-quiet" data-action="open-group-chat">Chat ${icon('arrow-up-right')}</button></div></article><article class="session-card" style="min-height:154px"><div class="game-symbol">${icon('users')}</div><h3>Know the roster</h3><div class="session-game">See the players behind the tags.</div><div class="session-card-footer"><span class="muted" style="font-size:10px">Four-player team</span><button class="inline-link button-quiet" data-page="members">Members ${icon('arrow-up-right')}</button></div></article></div></div></section>`;
}
async function renderSessions() {
  const [sessionsResult, members] = await Promise.all([
    state.supabase.from('gaming_sessions').select('id,title,game_name,description,scheduled_at,ends_at,status,created_by,creator:profiles!gaming_sessions_created_by_fkey(display_name),participants:gaming_session_members(user_id,profile:profiles(display_name,username,avatar_path))').order('scheduled_at', { ascending: true }), fetchMembers()
  ]);
  if (sessionsResult.error) throw sessionsResult.error;
  const sessions = sessionsResult.data || []; const upcoming = sessions.filter(s => new Date(s.scheduled_at) >= new Date() && ['scheduled','open'].includes(s.status));
  const makeCard = s => `<article class="surface session-card"><div class="session-card-top"><div class="game-symbol">${icon('gamepad-2')}</div>${pill(s.status.toUpperCase(), s.status === 'open' || s.status === 'scheduled' ? 'lime' : 'gray')}</div><h3>${escapeHTML(s.title)}</h3><div class="session-game">${escapeHTML(s.game_name)}</div>${s.description ? `<p class="muted" style="font-size:10px;line-height:1.65;margin:10px 0 0">${escapeHTML(s.description)}</p>` : ''}<div class="session-details"><span>${icon('calendar-days')}${formatDate(s.scheduled_at,{ month:'short',day:'numeric',year:'numeric' })}</span><span>${icon('clock')}${formatDate(s.scheduled_at,{ hour:'numeric',minute:'2-digit' })}${s.ends_at ? ` – ${formatDate(s.ends_at,{hour:'numeric',minute:'2-digit'})}` : ''}</span></div><div class="session-card-footer"><div class="participant-stack">${(s.participants || []).slice(0,4).map(p => avatarFallback(p.profile || { display_name: p.user_id === state.user.id ? state.profile.display_name : 'Member' }, 'avatar')).join('')}${pill(`${(s.participants || []).length} joined`)}</div><div style="display:flex;gap:6px">${upcoming.some(item => item.id === s.id) && !(s.participants || []).some(p => p.user_id === state.user.id) ? `<button class="primary-button button-small" data-action="join-session" data-id="${s.id}">Join</button>` : ''}${upcoming.some(item => item.id === s.id) && (s.participants || []).some(p => p.user_id === state.user.id) ? `<button class="secondary-button button-small" data-action="leave-session" data-id="${s.id}">Leave</button>` : ''}${(s.created_by === state.user.id || state.profile.role === 'admin') && ['open','scheduled'].includes(s.status) ? `<button class="secondary-button button-small" data-action="cancel-session" data-id="${s.id}">Cancel</button>` : ''}</div></div><div class="announcement-meta"><span>Created by ${escapeHTML(s.creator?.display_name || 'Squad member')}</span><span>${(s.participants || []).length}/${members.length} players</span></div></article>`;
  return `${pageHeading('GET THE CREW TOGETHER','Play sessions','Make a plan, lock in the time, and give the squad something to look forward to.',`<button class="primary-button" data-action="new-session">${icon('plus')} New session</button>`)}<div class="section-label" style="margin-bottom:12px">UPCOMING SESSIONS · ${upcoming.length}</div><div class="grid-3">${upcoming.map(makeCard).join('') || `<div class="surface" style="grid-column:1/-1">${emptyState('calendar-clock','No upcoming sessions','Start the next squad plan. Pick a game and a time that works for everyone.','<button class="primary-button" data-action="new-session">'+icon('plus')+' Plan a session</button>')}</div>`}</div><div class="section-label" style="margin:28px 0 12px">PAST & CANCELLED</div><div class="grid-3">${sessions.filter(s => !upcoming.some(u => u.id === s.id)).map(makeCard).join('') || `<div class="surface" style="grid-column:1/-1">${emptyState('history','No history yet','Completed sessions will stay here so the squad can look back.')}</div>`}</div>`;
}
async function getConversationList(kind) {
  const { data, error } = await state.supabase.from('conversation_members')
    .select('conversation_id,last_read_at,conversation:conversations!conversation_members_conversation_id_fkey(id,kind,title,updated_at,created_at)')
    .eq('user_id', state.user.id).order('joined_at', { ascending: false });
  if (error) throw error;
  const conversations = (data || []).map(row => ({ ...row.conversation, last_read_at: row.last_read_at, member_row: row })).filter(c => c?.kind === kind);
  for (const conv of conversations) {
    const { data: members, error: memberErr } = await state.supabase.from('conversation_members')
      .select('user_id,profile:profiles!conversation_members_user_id_fkey(id,username,display_name,avatar_path)')
      .eq('conversation_id', conv.id);
    if (!memberErr) conv.members = members || [];
    if (kind === 'private') conv.displayTitle = (conv.members || []).find(m => m.user_id !== state.user.id)?.profile?.display_name || 'Private chat';
    else conv.displayTitle = conv.title || 'Squad chat';
    const { data: lastMessage } = await state.supabase.from('messages').select('body,created_at,sender_id,attachment_path')
      .eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    conv.lastMessage = lastMessage;
  }
  return conversations.sort((a,b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
}
async function renderChat(kind) {
  state.activeChatKind = kind;
  let conversations = [];
  if (kind === 'group') {
    if (state.groupConversationId) {
      const { data, error } = await state.supabase.from('conversations').select('id,kind,title,updated_at,created_at').eq('id', state.groupConversationId).maybeSingle();
      if (error) throw error;
      if (data) { data.displayTitle = data.title || 'CODSQUAD'; data.members = state.members.map(p => ({ user_id: p.id, profile: p })); conversations = [data]; }
    }
  } else conversations = await getConversationList('private');
  state.conversationList = conversations;
  if (kind === 'group') state.activeConversationId = state.groupConversationId;
  else if (!conversations.some(c => c.id === state.activeConversationId)) state.activeConversationId = conversations[0]?.id || null;
  state.activeConversation = conversations.find(c => c.id === state.activeConversationId) || null;
  const active = state.activeConversation;
  const listHTML = conversations.map(c => `<button class="chat-list-item ${c.id === state.activeConversationId ? 'active' : ''}" data-action="select-conversation" data-id="${c.id}">${avatarFallback((c.members || []).find(m => m.user_id !== state.user.id)?.profile || { display_name: c.kind === 'group' ? 'CS' : c.displayTitle }, 'avatar')}<span class="chat-list-item-copy"><strong>${escapeHTML(c.displayTitle || c.title || 'Conversation')}</strong><small>${escapeHTML(c.lastMessage?.body || (c.lastMessage?.attachment_path ? 'Shared an image' : c.kind === 'group' ? 'Your squad room' : 'Start the conversation'))}</small></span><span class="chat-list-time">${c.lastMessage ? formatTime(c.lastMessage.created_at) : ''}</span></button>`).join('');
  let participants = [];
  if (active?.kind === 'group') participants = state.members;
  else if (active?.members) participants = active.members.map(m => m.profile).filter(Boolean);
  const headSub = active?.kind === 'group' ? `${participants.length || 4} members · Private group` : participants.find(p => p.id !== state.user.id)?.display_name || 'Private conversation';
  const chatPartner = participants.find(p => p.id !== state.user.id);
  const chatHeaderAvatar = active?.kind === 'group' ? avatarFallback({display_name:'CODSQUAD'}, 'avatar') : await avatarHTML(chatPartner, 'avatar');
  const heading = kind === 'group'
    ? pageHeading('STAY IN THE LOOP','Squad chat','All four players, one room. Keep the callouts, plans, and terrible jokes in one place.')
    : pageHeading('ONE ON ONE','Direct messages','Private conversations, just between you and another squad member.',`<button class="primary-button" data-action="new-dm">${icon('plus')} New message</button>`);
  const messages = await loadChatMessages(active?.id, true);
  return `${heading}<section id="chat-layout" class="chat-layout"><aside class="chat-list-panel"><div class="chat-list-header"><h2>${kind === 'group' ? 'Squad room' : 'Conversations'}</h2><p>${kind === 'group' ? 'One channel. Four voices.' : 'Your private threads'}</p><div class="search-field">${icon('search')}<input id="conversation-search" type="search" placeholder="Search conversations…" aria-label="Search conversations"></div></div><div id="conversation-list" class="chat-list">${listHTML || `<div class="chat-list-empty">${kind === 'private' ? 'No direct conversations yet.' : 'The squad room is waiting.'}</div>`}</div>${kind === 'private' ? `<div style="padding:12px"><button class="secondary-button button-small" style="width:100%" data-action="new-dm">${icon('plus')} Start a chat</button></div>` : ''}</aside><section class="chat-main"><header class="chat-head">${kind === 'private' ? `<button id="chat-list-back" class="icon-button" aria-label="Show conversation list" style="display:none">${icon('arrow-left')}</button>` : ''}${chatHeaderAvatar}<div class="chat-head-copy"><strong>${escapeHTML(active?.displayTitle || (kind === 'group' ? 'CODSQUAD' : 'Choose a conversation'))}</strong><small>${escapeHTML(headSub)}</small></div><div class="chat-head-actions"><button class="icon-button" data-action="refresh-chat" aria-label="Refresh messages">${icon('refresh-cw')}</button>${kind === 'group' ? `<button class="icon-button" data-page="members" aria-label="View members">${icon('users')}</button>` : ''}</div></header><div id="chat-messages" class="chat-messages">${messages || `<div class="chat-empty">${emptyState('messages-square',active ? 'It starts right here' : 'Choose your conversation',active ? 'Send the first message and bring the squad into the room.' : 'Pick a conversation on the left, or start a new one.')}</div>`}</div>${active ? `<form id="chat-composer" class="chat-composer"><input type="file" id="chat-file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden"><button class="icon-button composer-attach" type="button" data-action="attach-image" aria-label="Attach image">${icon('paperclip')}</button><div class="composer-field"><textarea id="message-input" rows="1" maxlength="4000" placeholder="Message ${kind === 'group' ? 'the squad' : 'your friend'}…" aria-label="Message"></textarea><div class="composer-hint">Enter to send <span>·</span> Shift + Enter for a new line</div></div><button type="submit" class="send-button" aria-label="Send message">${icon('send')}</button></form>` : ''}</section></section>`;
}
async function loadChatMessages(conversationId = state.activeConversationId, returnHtml = false) {
  if (!conversationId) return returnHtml ? '' : undefined;
  const [messageResult, receiptResult] = await Promise.all([
    state.supabase.from('messages').select('id,conversation_id,sender_id,body,attachment_path,attachment_mime,created_at,edited_at,deleted_at,sender:profiles!messages_sender_id_fkey(id,display_name,username,avatar_path)')
      .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(60),
    state.supabase.from('conversation_members').select('user_id,last_read_at').eq('conversation_id', conversationId)
  ]);
  if (messageResult.error) throw messageResult.error;
  const data = messageResult.data || []; const receiptRows = receiptResult.data || [];
  const messages = data.reverse();
  const urls = new Map();
  for (const m of messages) if (m.attachment_path) {
    const { data: signed } = await state.supabase.storage.from('codsquad-media').createSignedUrl(m.attachment_path, 900);
    if (signed?.signedUrl) urls.set(m.id, signed.signedUrl);
  }
  const html = messages.map(m => {
    const mine = m.sender_id === state.user.id; const deleted = Boolean(m.deleted_at);
    const image = !deleted && urls.get(m.id) ? `<img class="chat-media" src="${escapeAttr(urls.get(m.id))}" alt="Image shared in chat" loading="lazy">` : '';
    const body = deleted ? '<em>This message was deleted.</em>' : escapeHTML(m.body || '');
    const others = receiptRows.filter(r => r.user_id !== m.sender_id);
    const seenByOthers = others.length > 0 && others.every(r => r.last_read_at && new Date(r.last_read_at) >= new Date(m.created_at));
    return `<article class="message-row ${mine ? 'mine' : ''}" data-message-id="${m.id}">${!mine ? avatarFallback(m.sender, 'avatar message-avatar') : ''}<div class="message-content">${!mine ? `<div class="message-author">${escapeHTML(m.sender?.display_name || 'Member')}</div>` : ''}<div class="message-bubble">${image}${body}</div><div class="message-meta"><time>${formatTime(m.created_at)}</time>${m.edited_at && !deleted ? '<span class="edited-tag">edited</span>' : ''}${mine && !deleted ? `<span class="delivery-status ${seenByOthers ? 'seen' : ''}">${seenByOthers ? 'Seen' : 'Sent'}</span><button class="button-quiet" data-action="message-options" data-id="${m.id}" style="font-size:8px;padding:0 2px" aria-label="Message options">···</button>` : ''}</div></div></article>`;
  }).join('');
  if (returnHtml) return html;
  const host = $('#chat-messages'); if (host && (state.page === 'group-chat' || state.page === 'private-chat') && state.activeConversationId === conversationId) {
    const wasNearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 100;
    host.innerHTML = html || `<div class="chat-empty">${emptyState('messages-square','It starts right here','Send the first message and bring the squad into the room.')}</div>`;
    if (wasNearBottom) host.scrollTop = host.scrollHeight;
    refreshIcons();
  }
  return html;
}
function stopChatChannel() { if (state.chatChannel && state.supabase) state.supabase.removeChannel(state.chatChannel); state.chatChannel = null; }
function subscribeToChat(conversationId) {
  stopChatChannel(); if (!conversationId || !state.supabase) return;
  state.supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('user_id', state.user.id).then(({error}) => { if (error) console.warn('Could not update read marker:', error.message); else refreshBadges(); });
  state.chatChannel = state.supabase.channel(`chat-${conversationId}-${state.user.id}-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, () => debouncedReloadMessages())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversationId}` }, () => debouncedReloadMessages())
    .subscribe();
}
async function renderAnnouncements() {
  const { data, error } = await state.supabase.from('announcements').select('id,title,content,is_pinned,created_at,updated_at,author:profiles!announcements_author_id_fkey(display_name)').order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  const posts = data || []; const adminButton = state.profile.role === 'admin' ? `<button class="primary-button" data-action="new-announcement">${icon('plus')} New announcement</button>` : '';
  const content = posts.map(p => `<article class="surface announcement-card"><div class="announcement-meta" style="margin:0;padding:0;border:0"><span>${p.is_pinned ? pill('PINNED','lime') : pill('ANNOUNCEMENT')}</span><span>${relativeTime(p.created_at)}</span></div><h3>${escapeHTML(p.title)}</h3><p>${escapeHTML(p.content)}</p><div class="announcement-meta"><span>Posted by ${escapeHTML(p.author?.display_name || 'Squad admin')}${p.updated_at && p.updated_at !== p.created_at ? ' · Edited' : ''}</span>${state.profile.role === 'admin' ? `<span style="display:flex;gap:9px"><button class="button-quiet" data-action="edit-announcement" data-id="${p.id}">Edit</button><button class="button-quiet" data-action="delete-announcement" data-id="${p.id}" style="color:#e78b8b">Delete</button></span>` : ''}</div></article>`).join('');
  return `${pageHeading('SQUAD BULLETIN','Announcements','The important bits, pinned in one place. No more “wait, when did you say that?”',adminButton)}<div class="grid-2">${content || `<div class="surface" style="grid-column:1/-1">${emptyState('megaphone','No announcements yet','When the squad admin posts an update, it will land here.',adminButton || '')}</div>`}</div>`;
}
async function renderActivity() {
  const { data, error } = await state.supabase.from('activity_logs').select('id,event_type,title,detail,created_at,actor:profiles!activity_logs_actor_id_fkey(display_name,avatar_path)').order('created_at', { ascending: false }).limit(80);
  if (error) throw error; const events = data || [];
  return `${pageHeading('SQUAD PULSE','Activity feed','A lightweight log of the things happening around your private corner.') }<section class="surface"><div class="surface-header"><div><h2 class="surface-title">Latest activity</h2><p class="surface-subtitle">Private to the authorized squad</p></div>${pill(`${events.length} events`)}</div><div class="surface-body">${events.length ? `<div class="activity-timeline">${events.map(e => `<div class="timeline-item"><div style="flex:1"><h3>${escapeHTML(e.title || e.event_type || 'Squad activity')}</h3><p>${escapeHTML(e.detail || '')}${e.actor?.display_name ? ` · ${escapeHTML(e.actor.display_name)}` : ''}</p><time>${formatDate(e.created_at,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</time></div></div>`).join('')}</div>` : emptyState('activity','Quiet for now','The feed will start filling as people schedule games, update profiles, and share announcements.')}</div></section>`;
}
async function renderNotifications() {
  const { data, error } = await state.supabase.from('notifications').select('id,type,title,body,entity_type,entity_id,read_at,created_at').eq('recipient_id', state.user.id).order('created_at', { ascending: false }).limit(80);
  if (error) throw error; const list = data || []; const unread = list.filter(n => !n.read_at).length;
  const content = list.map(n => `<div class="notification-item ${n.read_at ? '' : 'unread'}"><div class="activity-icon">${icon(n.type === 'message' ? 'message-circle' : n.type === 'announcement' ? 'megaphone' : 'bell')}</div><div class="notification-copy"><strong>${escapeHTML(n.title)}</strong><p>${escapeHTML(n.body || '')}</p><time>${relativeTime(n.created_at)}</time></div>${n.read_at ? '' : '<span class="notification-unread-dot"></span>'}<button class="button-quiet" data-action="read-notification" data-id="${n.id}" aria-label="Mark notification as read">${icon(n.read_at ? 'check' : 'check-check')}</button></div>`).join('');
  return `${pageHeading('DON’T MISS A THING','Notifications','A small heads-up when something changes in your squad.',`<button class="secondary-button" data-action="mark-all-read" ${unread ? '' : 'disabled'}>${icon('check-check')} Mark all read</button>`)}<section class="surface"><div class="surface-header"><div><h2 class="surface-title">Your inbox</h2><p class="surface-subtitle">Only notifications meant for you</p></div>${pill(`${unread} unread`, unread ? 'lime' : 'gray')}</div>${content || emptyState('bell','All caught up','When there is something to know, it will show up here.')}</section>`;
}
async function renderSettings() {
  const p = state.profile;
  let savedPrefs = { notifications_enabled: true, presence_visible: true };
  if (state.settingsTab === 'preferences') { const { data } = await state.supabase.from('user_settings').select('notifications_enabled,presence_visible').eq('user_id', state.user.id).maybeSingle(); if (data) savedPrefs = { ...savedPrefs, ...data }; }
  return `${pageHeading('YOUR SPACE, YOUR WAY','Settings','Keep your profile up to date and choose how CODSQUAD feels.') }<div class="settings-layout"><nav class="surface settings-tabs" aria-label="Settings sections"><button class="settings-tab ${state.settingsTab === 'profile' ? 'active' : ''}" data-action="settings-tab" data-tab="profile">${icon('user-round')} Profile</button><button class="settings-tab ${state.settingsTab === 'preferences' ? 'active' : ''}" data-action="settings-tab" data-tab="preferences">${icon('sliders-horizontal')} Preferences</button><button class="settings-tab ${state.settingsTab === 'security' ? 'active' : ''}" data-action="settings-tab" data-tab="security">${icon('shield-check')} Security</button></nav><section class="surface settings-section">${state.settingsTab === 'profile' ? `<h2>Your profile</h2><p>This is how your squad sees you around the hub.</p><div class="profile-editor-top">${await avatarHTML(p,'avatar member-big-avatar')}<div class="profile-editor-top-copy"><strong>${escapeHTML(p.display_name)}</strong><p>@${escapeHTML(p.username || '')} · ${p.role === 'admin' ? 'Squad admin' : 'Squad member'}</p><label class="secondary-button button-small" for="avatar-upload" style="display:inline-flex;margin-top:9px;cursor:pointer">${icon('image-up')} Change picture</label><input id="avatar-upload" type="file" class="hidden" accept="image/jpeg,image/png,image/webp,image/gif"></div></div><form id="profile-form" class="settings-form"><div class="form-row"><div class="field-group"><label class="field-label" for="profile-name">Display name</label><input class="field-input" id="profile-name" name="display_name" maxlength="60" required value="${escapeAttr(p.display_name || '')}"></div><div class="field-group"><label class="field-label" for="profile-username">Username</label><input class="field-input" id="profile-username" name="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" required value="${escapeAttr(p.username || '')}"><small class="field-help">Letters, numbers and underscores.</small></div></div><div class="field-group"><label class="field-label" for="profile-bio">Bio</label><textarea class="field-textarea" id="profile-bio" name="bio" maxlength="240" placeholder="A little about you…">${escapeHTML(p.bio || '')}</textarea></div><div class="field-group"><label class="field-label" for="profile-games">Favorite games</label><input class="field-input" id="profile-games" name="favorite_games" maxlength="300" value="${escapeAttr((p.favorite_games || []).join(', '))}" placeholder="Valorant, Minecraft, GTA V"><small class="field-help">Separate games with commas. Keep it to 12 games or fewer.</small></div><div class="field-group"><label class="field-label" for="profile-status">Gaming status</label><select class="field-select" id="profile-status" name="gaming_status"><option value="offline" ${p.gaming_status === 'offline' ? 'selected' : ''}>Offline</option><option value="available" ${p.gaming_status === 'available' ? 'selected' : ''}>Available to play</option><option value="playing" ${p.gaming_status === 'playing' ? 'selected' : ''}>Currently playing</option><option value="busy" ${p.gaming_status === 'busy' ? 'selected' : ''}>Busy</option></select></div><div><button type="submit" class="primary-button">Save profile ${icon('check')}</button></div></form>` : state.settingsTab === 'preferences' ? `<h2>Preferences</h2><p>A few details that make your hub feel right.</p><form id="preferences-form" class="settings-form"><div class="inline-notice">${icon('moon-star')} CODSQUAD currently uses its dark gaming theme throughout. More appearance options can be added without changing the saved data model.</div><div class="field-group"><label class="field-label" for="pref-notifications">In-app notifications</label><select id="pref-notifications" name="notifications_enabled" class="field-select"><option value="true" ${savedPrefs.notifications_enabled ? 'selected' : ''}>Enabled</option><option value="false" ${!savedPrefs.notifications_enabled ? 'selected' : ''}>Disabled</option></select><small class="field-help">You can still open the notification inbox when this setting is disabled.</small></div><div class="field-group"><label class="field-label" for="pref-presence">Presence visibility</label><select id="pref-presence" name="presence_visible" class="field-select"><option value="true" ${savedPrefs.presence_visible ? 'selected' : ''}>Show me as online while connected</option><option value="false" ${!savedPrefs.presence_visible ? 'selected' : ''}>Do not share my online presence</option></select></div><button class="primary-button" type="submit">Save preferences ${icon('check')}</button></form>` : `<h2>Account security</h2><p>Keep access to the inner circle safe.</p><div class="inline-notice">${icon('shield-check')} Invite-only access is managed by the CODSQUAD administrator. Never share your password or a private login link.</div><form id="reset-password-form" class="settings-form" style="margin-top:20px"><div class="field-group"><label class="field-label" for="new-password">New password</label><input id="new-password" class="field-input" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"><small class="field-help">Use a password you do not reuse elsewhere.</small></div><div class="field-group"><label class="field-label" for="confirm-password">Confirm new password</label><input id="confirm-password" class="field-input" name="confirm_password" type="password" autocomplete="new-password" minlength="8" required placeholder="Enter it one more time"></div><button class="primary-button" type="submit">Update password ${icon('lock-keyhole')}</button></form><div class="divider-label">SIGNED IN AS</div><div class="list-row"><div class="activity-icon">${icon('mail')}</div><div class="list-row-copy"><strong>${escapeHTML(state.user.email || 'Email not available')}</strong><small>Authenticated with Supabase</small></div></div><div class="danger-zone" style="margin-top:22px"><strong>Sign out of CODSQUAD</strong><p>This signs you out of this browser. Your saved profile and conversations remain in the database.</p><button class="danger-button button-small" data-action="logout">${icon('log-out')} Sign out</button></div>`}</section></div>`;
}
async function renderAdmin() {
  if (state.profile.role !== 'admin') return renderNotFound();
  const [members, sessionQ, messageQ, announceQ] = await Promise.all([
    fetchMembers(),
    state.supabase.from('gaming_sessions').select('id', { count: 'exact', head: true }),
    state.supabase.from('messages').select('id', { count: 'exact', head: true }),
    state.supabase.from('announcements').select('id', { count: 'exact', head: true })
  ]);
  if (sessionQ.error) throw sessionQ.error; if (messageQ.error) throw messageQ.error; if (announceQ.error) throw announceQ.error;
  const memberRows = await Promise.all(members.map(async p => `<tr><td><div class="compact-avatars">${await avatarHTML(p,'avatar')}<div><strong>${escapeHTML(p.display_name)}</strong><small>@${escapeHTML(p.username || '')}</small></div></div></td><td>${p.role === 'admin' ? pill('ADMIN','lime') : pill('MEMBER')}</td><td>${memberOnline(p) ? pill('ONLINE','lime') : pill('OFFLINE')}</td><td>${formatDate(p.created_at)}</td></tr>`));
  return `${pageHeading('RESTRICTED AREA','Admin desk','A simple control room for the private CODSQUAD community.') }<div class="grid-4"><div class="surface admin-stat"><span>Authorized members</span><strong>${members.length}/4</strong></div><div class="surface admin-stat"><span>Gaming sessions</span><strong>${sessionQ.count || 0}</strong></div><div class="surface admin-stat"><span>Messages you can access</span><strong>${messageQ.count || 0}</strong></div><div class="surface admin-stat"><span>Announcements</span><strong>${announceQ.count || 0}</strong></div></div><section class="surface" style="margin-top:18px"><div class="surface-header"><div><h2 class="surface-title">Authorized members</h2><p class="surface-subtitle">Access status comes from Supabase, not a browser-side flag.</p></div><button class="secondary-button button-small" data-action="show-access-guide">${icon('key-round')} Access setup</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>MEMBER</th><th>ROLE</th><th>PRESENCE</th><th>JOINED</th></tr></thead><tbody>${memberRows.join('')}</tbody></table></div></section><section class="surface" style="margin-top:18px"><div class="surface-header"><div><h2 class="surface-title">Quick actions</h2><p class="surface-subtitle">Content actions are available inside the relevant sections.</p></div></div><div class="surface-body"><div class="grid-3"><button class="secondary-button" data-action="new-announcement">${icon('megaphone')} Post announcement</button><button class="secondary-button" data-action="new-session">${icon('calendar-plus')} Create session</button><button class="secondary-button" data-action="show-access-guide">${icon('users')} Manage member access</button></div><p class="field-help" style="margin-top:14px">Creating Supabase Auth users and assigning admin/authorized roles should be done using the Supabase dashboard or trusted server-side tools. This frontend intentionally does not expose privileged credentials.</p></div></section>`;
}
function renderNotFound() { return `${pageHeading('NOT FOUND','Wrong turn, squadmate.','This page does not exist, or your account does not have access.', '<button class="primary-button" data-page="dashboard">Back to overview</button>')}<section class="surface">${emptyState('compass','Nothing to see here','Head back to the overview and keep the squad moving.')}</section>`; }

function bindPageActions() {
  const chatHost = $('#chat-messages');
  if (chatHost) subscribeToChat(state.activeConversationId);
  const unreadHost = $('#dashboard-unread');
  if (unreadHost) state.supabase.from('notifications').select('id',{count:'exact',head:true}).eq('recipient_id',state.user.id).is('read_at',null).then(({count}) => { if ($('#dashboard-unread')) $('#dashboard-unread').textContent = String(count || 0); });
  if (state.page === 'private-chat' || state.page === 'group-chat') {
    const back = $('#chat-list-back'); if (back) back.addEventListener('click', () => $('#chat-layout').classList.add('show-list'));
    const search = $('#conversation-search'); if (search) search.addEventListener('input', () => {
      const value = search.value.toLowerCase(); $$('.chat-list-item').forEach(item => item.classList.toggle('hidden', !item.textContent.toLowerCase().includes(value)));
    });
    const composer = $('#chat-composer'); if (composer) composer.addEventListener('submit', sendChatMessage);
    const input = $('#message-input'); if (input) {
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); composer.requestSubmit(); } });
      input.addEventListener('input', () => { input.style.height = '38px'; input.style.height = `${Math.min(input.scrollHeight,125)}px`; });
    }
  }
  const memberSearch = $('#member-search'); if (memberSearch) {
    memberSearch.addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(async () => { const cursor = memberSearch.selectionStart; const html = await renderMembers(memberSearch.value); $('#page-content').innerHTML = html; refreshIcons(); bindPageActions(); const next = $('#member-search'); if (next) { next.focus(); next.setSelectionRange(cursor,cursor); } }, 160); });
  }
  const profileForm = $('#profile-form'); if (profileForm) profileForm.addEventListener('submit', saveProfile);
  const statusForm = $('#gaming-status-form'); if (statusForm) statusForm.addEventListener('submit', saveGamingStatus);
  const preferencesForm = $('#preferences-form'); if (preferencesForm) preferencesForm.addEventListener('submit', savePreferences);
  const resetForm = $('#reset-password-form'); if (resetForm) resetForm.addEventListener('submit', updatePassword);
  const fileInput = $('#chat-file'); if (fileInput) fileInput.addEventListener('change', uploadChatImage);
  const avatarUpload = $('#avatar-upload'); if (avatarUpload) avatarUpload.addEventListener('change', uploadAvatar);
}

async function sendChatMessage(event) {
  event.preventDefault(); const input = $('#message-input'); const body = input?.value.trim();
  if (!body) return;
  if (!state.activeConversationId) { toast('Choose a conversation','Select a chat before sending a message.','error'); return; }
  const submit = $('button[type="submit"]', event.currentTarget); if (submit) submit.disabled = true;
  try {
    const { error } = await state.supabase.from('messages').insert({ conversation_id: state.activeConversationId, sender_id: state.user.id, body });
    if (error) throw error;
    input.value = ''; input.style.height = '38px'; await loadChatMessages(); await refreshBadges();
  } catch (error) { toast('Message not sent', cleanError(error), 'error'); }
  finally { if (submit) submit.disabled = false; input?.focus(); }
}
async function uploadChatImage(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (!state.activeConversationId) return toast('Choose a conversation','Select a chat before attaching an image.','error');
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) return toast('Unsupported file','Choose a JPG, PNG, WebP, or GIF image.','error');
  if (file.size > 5 * 1024 * 1024) return toast('Image is too large','Images must be 5 MB or smaller.','error');
  const path = `${state.user.id}/${state.activeConversationId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-90)}`;
  toast('Uploading image','Your image is being added to the private chat.');
  try {
    const { error: uploadError } = await state.supabase.storage.from('codsquad-media').upload(path,file,{contentType:file.type,upsert:false});
    if (uploadError) throw uploadError;
    const { error } = await state.supabase.from('messages').insert({conversation_id:state.activeConversationId,sender_id:state.user.id,body:'',attachment_path:path,attachment_mime:file.type});
    if (error) { await state.supabase.storage.from('codsquad-media').remove([path]); throw error; }
    await loadChatMessages(); toast('Image shared','Your image is now in the conversation.');
  } catch (error) { toast('Upload failed',cleanError(error),'error'); }
}
async function uploadAvatar(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 5*1024*1024) return toast('Check that image','Choose JPG, PNG, WebP, or GIF up to 5 MB.','error');
  const path = `${state.user.id}/avatar-${crypto.randomUUID()}.${file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g,'').slice(0,5) || 'png'}`;
  try {
    const { error: uploadErr } = await state.supabase.storage.from('codsquad-media').upload(path,file,{contentType:file.type,upsert:false}); if (uploadErr) throw uploadErr;
    const old = state.profile.avatar_path;
    const { error } = await state.supabase.from('profiles').update({avatar_path:path}).eq('id',state.user.id); if (error) { await state.supabase.storage.from('codsquad-media').remove([path]); throw error; }
    state.profile.avatar_path = path; state.avatarCache.clear(); if (old) await state.supabase.storage.from('codsquad-media').remove([old]);
    updateCurrentUserUI(); toast('Profile picture updated','Looking good, squadmate!'); navigate('settings',{replace:true});
  } catch (error) { toast('Upload failed',cleanError(error),'error'); }
}
async function saveProfile(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const games = String(form.get('favorite_games') || '').split(',').map(v=>v.trim()).filter(Boolean).slice(0,12);
  const username = String(form.get('username')||'').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return toast('Check your username','Use 3–24 letters, numbers, or underscores.','error');
  const payload = { display_name:String(form.get('display_name')||'').trim(), username, bio:String(form.get('bio')||'').trim(), favorite_games:games, gaming_status:String(form.get('gaming_status')||'offline') };
  try {
    const { data,error } = await state.supabase.from('profiles').update(payload).eq('id',state.user.id).select().single(); if (error) throw error;
    state.profile = { ...state.profile, ...data }; updateCurrentUserUI(); await fetchMembers(); await logActivity('profile','updated their profile'); toast('Profile saved','Your squad profile is up to date.'); navigate('settings',{replace:true});
  } catch(error) { toast('Could not save profile',/duplicate key|username/i.test(error.message) ? 'That username is already taken. Try another one.' : cleanError(error),'error'); }
}
async function saveGamingStatus(event) {
  event.preventDefault(); const status = $('#gaming-status').value;
  try { const { error } = await state.supabase.from('profiles').update({gaming_status:status}).eq('id',state.user.id); if(error) throw error; state.profile.gaming_status=status; await fetchMembers(); await logActivity('status',`changed gaming status to ${status}`); toast('Status updated','The squad can see your current status.'); navigate('gaming',{replace:true}); }
  catch(error) { toast('Could not update status',cleanError(error),'error'); }
}
async function savePreferences(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  try { const { error } = await state.supabase.from('user_settings').upsert({user_id:state.user.id,notifications_enabled:form.get('notifications_enabled')==='true',presence_visible:form.get('presence_visible')==='true',updated_at:new Date().toISOString()},{onConflict:'user_id'}); if(error) throw error;
    if(form.get('presence_visible')==='false' && state.presenceChannel) { await state.presenceChannel.untrack(); state.presenceIds.delete(state.user.id); }
    else if(state.presenceChannel) await state.presenceChannel.track({user_id:state.user.id,display_name:state.profile.display_name,online_at:new Date().toISOString()});
    await refreshBadges(); toast('Preferences saved','Your preferences have been updated.');
  } catch(error) { toast('Could not save settings',cleanError(error),'error'); }
}
async function updatePassword(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget); const password = String(form.get('password')||'');
  if(password.length < 8) return toast('Password too short','Use at least 8 characters.','error');
  if(password !== form.get('confirm_password')) return toast('Passwords do not match','Enter the same password in both fields.','error');
  try { const {error} = await state.supabase.auth.updateUser({password}); if(error) throw error; event.currentTarget.reset(); toast('Password updated','Your new password is active.'); }
  catch(error) { toast('Could not update password',cleanError(error),'error'); }
}
async function openModal(title, bodyHTML, onSubmit = null, submitLabel = 'Save changes') {
  $('#modal-title').textContent = title; $('#modal-body').innerHTML = bodyHTML;
  $('#modal-backdrop').classList.remove('hidden'); refreshIcons();
  const form = $('#modal-form');
  if (form && onSubmit) form.addEventListener('submit', async event => { event.preventDefault(); const button = $('button[type="submit"]',form); if(button)button.disabled=true; try { const result = await onSubmit(new FormData(form), form); if(result !== false) closeModal(); } catch(error) { const holder = $('#modal-form-error'); if(holder) holder.textContent = cleanError(error); else toast('Could not complete action',cleanError(error),'error'); } finally {if(button)button.disabled=false;} });
  $('#modal-close').focus();
}
function closeModal() { $('#modal-backdrop').classList.add('hidden'); $('#modal-body').innerHTML = ''; }
function modalFooter(label = 'Save changes', danger = false) { return `<div id="modal-form-error" class="field-error" aria-live="polite"></div><div class="modal-form-actions"><button type="button" class="secondary-button button-small" data-action="close-modal">Cancel</button><button type="submit" class="${danger ? 'danger-button' : 'primary-button'} button-small">${escapeHTML(label)} ${icon('arrow-up-right')}</button></div>`; }
async function newSessionModal() {
  const now = new Date(Date.now()+60*60*1000); now.setMinutes(Math.ceil(now.getMinutes()/15)*15,0,0); const date = new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  await openModal('Plan a squad session',`<form id="modal-form" class="modal-form"><div class="field-group"><label class="field-label" for="session-title">Session title</label><input class="field-input" id="session-title" name="title" maxlength="90" required placeholder="Friday night ranked run"></div><div class="field-group"><label class="field-label" for="session-game">Game name</label><input class="field-input" id="session-game" name="game_name" maxlength="70" required placeholder="Valorant, Minecraft, GTA V…"></div><div class="field-group"><label class="field-label" for="session-date">Start date & time</label><input class="field-input" id="session-date" name="scheduled_at" type="datetime-local" min="${date}" value="${date}" required></div><div class="field-group"><label class="field-label" for="session-end">End date & time (optional)</label><input class="field-input" id="session-end" name="ends_at" type="datetime-local" min="${date}"></div><div class="field-group"><label class="field-label" for="session-description">Description (optional)</label><textarea class="field-textarea" id="session-description" name="description" maxlength="500" placeholder="Server, mode, loadout, or anything the squad should know."></textarea></div>${modalFooter('Create session')}</form>`,async form=>{
    const scheduled = new Date(String(form.get('scheduled_at'))); const endRaw=String(form.get('ends_at')||'').trim(); const ends=endRaw ? new Date(endRaw) : null; if(!Number.isFinite(scheduled.getTime()) || scheduled <= new Date()) { $('#modal-form-error').textContent='Choose a future date and time.'; return false; } if(ends && (!Number.isFinite(ends.getTime()) || ends <= scheduled)) { $('#modal-form-error').textContent='The end time must be later than the start time.'; return false; }
    const {data,error}=await state.supabase.from('gaming_sessions').insert({title:String(form.get('title')).trim(),game_name:String(form.get('game_name')).trim(),description:String(form.get('description')||'').trim(),scheduled_at:scheduled.toISOString(),ends_at:ends ? ends.toISOString() : null,created_by:state.user.id,status:'scheduled'}).select().single(); if(error)throw error;
    const {error:joinError}=await state.supabase.from('gaming_session_members').insert({session_id:data.id,user_id:state.user.id}); if(joinError)console.warn('Could not auto-join creator:',joinError.message);
    await logActivity('session',`created a gaming session: ${data.title}`,data.game_name,data.id); toast('Session created','Your squad session is on the calendar.'); navigate('sessions');
  },'Create session');
}
async function joinSession(id) {
  const {error}=await state.supabase.from('gaming_session_members').insert({session_id:id,user_id:state.user.id}); if(error && !/duplicate key/i.test(error.message)) throw error;
  await logActivity('session','joined a gaming session','',id); toast('You are in','Added you to the session roster.'); await renderPage();
}
async function leaveSession(id) {
  const {error}=await state.supabase.from('gaming_session_members').delete().eq('session_id',id).eq('user_id',state.user.id); if(error)throw error;
  await logActivity('session','left a gaming session','',id); toast('Left the session','You have been removed from the participant list.'); await renderPage();
}
async function cancelSession(id) {
  if(!confirm('Cancel this gaming session for the squad?')) return;
  const {error}=await state.supabase.from('gaming_sessions').update({status:'cancelled'}).eq('id',id); if(error)throw error;
  await logActivity('session','cancelled a gaming session','',id); toast('Session cancelled','The session has been marked as cancelled.'); await renderPage();
}
async function newAnnouncementModal(existing = null) {
  if(state.profile.role !== 'admin') return toast('Admin access required','Only the CODSQUAD admin can publish announcements.','error');
  const p=existing || {title:'',content:'',is_pinned:false};
  await openModal(existing ? 'Edit announcement' : 'New announcement',`<form id="modal-form" class="modal-form"><div class="field-group"><label class="field-label" for="announcement-title">Title</label><input id="announcement-title" class="field-input" name="title" maxlength="120" required value="${escapeAttr(p.title)}" placeholder="Squad update"></div><div class="field-group"><label class="field-label" for="announcement-content">Message</label><textarea id="announcement-content" class="field-textarea" name="content" maxlength="5000" required placeholder="What does everyone need to know?">${escapeHTML(p.content)}</textarea></div><label style="display:flex;align-items:center;gap:9px;color:#aebaa6;font-size:11px"><input type="checkbox" name="is_pinned" ${p.is_pinned?'checked':''}> Pin this announcement</label>${modalFooter(existing?'Save announcement':'Publish announcement')}</form>`,async form=>{
    const payload={title:String(form.get('title')).trim(),content:String(form.get('content')).trim(),is_pinned:form.get('is_pinned')==='on'};
    if(existing){const {error}=await state.supabase.from('announcements').update(payload).eq('id',existing.id);if(error)throw error;toast('Announcement updated','Changes saved for the squad.');}
    else{const {data,error}=await state.supabase.from('announcements').insert({...payload,author_id:state.user.id}).select().single();if(error)throw error;await logActivity('announcement','published an announcement',payload.title,data.id);toast('Announcement published','Your update is live for the squad.');}
    navigate('announcements');
  },existing?'Save changes':'Publish');
}
async function editAnnouncement(id) { const {data,error}=await state.supabase.from('announcements').select('id,title,content,is_pinned').eq('id',id).single();if(error)throw error;return newAnnouncementModal(data); }
async function deleteAnnouncement(id) { if(!confirm('Delete this announcement?'))return; const {error}=await state.supabase.from('announcements').delete().eq('id',id);if(error)throw error;toast('Announcement deleted','It has been removed.');await renderPage(); }
async function markNotificationRead(id) { const {error}=await state.supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('recipient_id',state.user.id);if(error)throw error;await refreshBadges();await renderPage(); }
async function markAllRead() { const {error}=await state.supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('recipient_id',state.user.id).is('read_at',null);if(error)throw error;await refreshBadges();toast('All caught up','Your notifications have been marked as read.');await renderPage(); }
async function openProfile(id) {
  const p=state.members.find(m=>m.id===id);if(!p)return;
  await openModal(p.display_name,`<div class="profile-editor-top">${await avatarHTML(p,'avatar member-big-avatar')}<div class="profile-editor-top-copy"><strong>${escapeHTML(p.display_name)}</strong><p>@${escapeHTML(p.username||'squad-member')} ${p.role==='admin'?'· Squad admin':''}</p></div></div><p class="muted" style="font-size:12px;line-height:1.8">${escapeHTML(p.bio||'This player is letting the game do the talking.')}</p><div class="divider-label">FAVORITE GAMES</div><div class="tag-row">${(p.favorite_games||[]).map(g=>`<span class="tag">${escapeHTML(g)}</span>`).join('')||'<span class="muted" style="font-size:11px">No favorites added yet.</span>'}</div><div class="divider-label">CURRENT STATUS</div><div>${pill(p.gaming_status||'offline',p.gaming_status==='available'?'lime':'gray')} ${memberOnline(p)?pill('online now','lime'):pill('offline')}</div><div class="modal-form-actions" style="margin-top:22px">${p.id!==state.user.id?`<button type="button" class="primary-button" data-action="start-dm" data-user-id="${p.id}">${icon('message-circle')} Send a message</button>`:`<button type="button" class="primary-button" data-page="settings">Edit my profile</button>`}</div>`);
}
async function startDM(targetId) {
  if(targetId===state.user.id)return navigate('settings');
  const {data,error}=await state.supabase.rpc('create_private_conversation',{target_user_id:targetId});if(error)throw error;
  closeModal();state.activeConversationId=data;await refreshBadges();navigate('private-chat');
}
async function showSearchModal() {
  await openModal('Search your squad',`<div class="field-group"><label class="field-label" for="global-search-input">Search members, announcements, or sessions</label><div class="search-field" style="width:100%">${icon('search')}<input id="global-search-input" type="search" placeholder="Start typing…" autocomplete="off" style="height:43px"></div></div><div id="global-search-results" style="margin-top:14px">${emptyState('search','Find your thing','Search results will appear here.')}</div>`);
  const input=$('#global-search-input'); input.focus(); input.addEventListener('input',()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>runGlobalSearch(input.value),240);});
}
async function runGlobalSearch(term) {
  const holder=$('#global-search-results'); if(!holder)return; term=term.trim(); if(term.length<2){holder.innerHTML=emptyState('search','Keep typing','Enter at least two characters to search.');refreshIcons();return;}
  try {
    const safeTerm=term.replace(/[^a-zA-Z0-9 _-]/g,' ').trim(); if(safeTerm.length<2){holder.innerHTML=emptyState('search','Try plain text','Use letters, numbers, spaces, hyphens or underscores.');refreshIcons();return;} const pattern=`%${safeTerm}%`;
    const [members,announcements,sessions,messages]=await Promise.all([
      state.supabase.from('profiles').select('id,display_name,username').eq('is_authorized',true).or(`display_name.ilike.${pattern},username.ilike.${pattern}`).limit(4),
      state.supabase.from('announcements').select('id,title,content').ilike('title',pattern).limit(4),
      state.supabase.from('gaming_sessions').select('id,title,game_name').or(`title.ilike.${pattern},game_name.ilike.${pattern}`).limit(4),
      state.supabase.from('messages').select('id,conversation_id,body,created_at,conversation:conversations!messages_conversation_id_fkey(kind,title)').ilike('body',pattern).order('created_at',{ascending:false}).limit(5)
    ]);
    for(const res of [members,announcements,sessions,messages])if(res.error)throw res.error;
    const parts=[];
    for(const p of members.data||[])parts.push(`<button class="chat-list-item" style="width:100%" data-action="search-profile" data-id="${p.id}">${avatarFallback(p,'avatar')}<span class="chat-list-item-copy"><strong>${escapeHTML(p.display_name)}</strong><small>Member · @${escapeHTML(p.username||'')}</small></span>${icon('arrow-up-right')}</button>`);
    for(const a of announcements.data||[])parts.push(`<button class="chat-list-item" style="width:100%" data-action="search-announcements">${icon('megaphone')}<span class="chat-list-item-copy"><strong>${escapeHTML(a.title)}</strong><small>Announcement · ${escapeHTML(a.content.slice(0,70))}</small></span>${icon('arrow-up-right')}</button>`);
    for(const s of sessions.data||[])parts.push(`<button class="chat-list-item" style="width:100%" data-action="search-sessions">${icon('gamepad-2')}<span class="chat-list-item-copy"><strong>${escapeHTML(s.title)}</strong><small>Gaming session · ${escapeHTML(s.game_name)}</small></span>${icon('arrow-up-right')}</button>`);
    for(const m of messages.data||[])parts.push(`<button class="chat-list-item" style="width:100%" data-action="search-message" data-id="${m.conversation_id}" data-kind="${m.conversation?.kind||'private'}">${icon('message-circle')}<span class="chat-list-item-copy"><strong>${escapeHTML((m.body||'Message').slice(0,80))}</strong><small>Message · ${formatTime(m.created_at)} · ${escapeHTML(m.conversation?.title||m.conversation?.kind||'Conversation')}</small></span>${icon('arrow-up-right')}</button>`);
    holder.innerHTML=parts.length?`<div class="section-label" style="margin-bottom:9px">RESULTS · ${parts.length}</div>${parts.join('')}`:emptyState('search','No results found','Try another name, game, or announcement.');refreshIcons();
  }catch(error){holder.textContent=cleanError(error);}
}
function showAccessGuide() {
  closeModal();openModal('Authorize your four members',`<div class="inline-notice">${icon('shield-check')} CODSQUAD is invite-only. This interface intentionally does not expose any privileged Supabase key or let users promote themselves.</div><ol style="color:#aab6a2;font-size:11px;line-height:1.9;padding-left:20px"><li>Create the four accounts in Supabase Dashboard → Authentication → Users.</li><li>Open SQL Editor and use the prepared <code>002_authorize_four_members.sql</code> script.</li><li>Replace the example emails with each person's real login email.</li><li>Assign one trusted account the <code>admin</code> role; the others are <code>member</code>.</li><li>Keep public sign-ups disabled and test access using a non-member account.</li></ol><div class="field-help">The README includes the full setup and security checklist. Never share the service_role secret.</div><div class="modal-form-actions"><button class="primary-button" data-action="close-modal">Got it</button></div>`);
}
function handleAction(action, el) {
  const id=el.dataset.id,userId=el.dataset.userId;
  const safely=promise=>Promise.resolve(promise).catch(error=>toast('That did not work',cleanError(error),'error'));
  switch(action){
    case 'retry-page': return renderPage();
    case 'open-group-chat': return navigate('group-chat');
    case 'view-sessions': return navigate('sessions');
    case 'new-session': return safely(newSessionModal());
    case 'new-announcement': return safely(newAnnouncementModal());
    case 'edit-announcement': return safely(editAnnouncement(id));
    case 'delete-announcement': return safely(deleteAnnouncement(id));
    case 'join-session': return safely(joinSession(id));
    case 'leave-session': return safely(leaveSession(id));
    case 'cancel-session': return safely(cancelSession(id));
    case 'new-dm': return safely(openDMChooser());
    case 'start-dm': return safely(startDM(userId));
    case 'view-profile': return safely(openProfile(userId));
    case 'select-conversation': state.activeConversationId=id; closeModal(); if(state.page==='private-chat')$('#chat-layout')?.classList.remove('show-list'); return safely(renderPage());
    case 'refresh-chat': return safely(loadChatMessages());
    case 'attach-image': return $('#chat-file')?.click();
    case 'settings-tab': state.settingsTab=el.dataset.tab; return safely(renderPage());
    case 'edit-status': return safely(navigate('settings'));
    case 'read-notification': return safely(markNotificationRead(id));
    case 'mark-all-read': return safely(markAllRead());
    case 'close-modal': return closeModal();
    case 'logout': return safely(signOut());
    case 'show-access-guide': return showAccessGuide();
    case 'search-profile': return safely((async()=>{const person=state.members.find(p=>p.id===id);if(person){closeModal();navigate('members');setTimeout(()=>openProfile(id),100);}})());
    case 'search-announcements': closeModal(); return navigate('announcements');
    case 'search-sessions': closeModal(); return navigate('sessions');
    case 'search-message': closeModal(); state.activeConversationId=id; return navigate(el.dataset.kind === 'group' ? 'group-chat' : 'private-chat');
    case 'message-options': return safely(messageOptions(id));
    default: return;
  }
}
async function openDMChooser() {
  const others=state.members.filter(p=>p.id!==state.user.id);
  const rows=await Promise.all(others.map(async p=>`<button type="button" class="chat-list-item" style="width:100%" data-action="start-dm" data-user-id="${p.id}">${await avatarHTML(p,'avatar')}<span class="chat-list-item-copy"><strong>${escapeHTML(p.display_name)}</strong><small>@${escapeHTML(p.username||'squad-member')}</small></span>${icon('message-circle')}</button>`));
  await openModal('Who are we messaging?',`<p class="muted" style="font-size:11px;margin:0 0 13px">Pick a squad member to open a private, one-to-one conversation.</p><div>${rows.join('')||emptyState('users','No other members yet','Once the rest of the squad is authorized, they will appear here.')}</div>`);
}
async function messageOptions(id) {
  const {data,error}=await state.supabase.from('messages').select('id,body,created_at').eq('id',id).eq('sender_id',state.user.id).single();if(error)throw error;
  await openModal('Message options',`<div class="field-group"><label class="field-label" for="edit-message-body">Your message</label><textarea class="field-textarea" id="edit-message-body" maxlength="4000">${escapeHTML(data.body||'')}</textarea><div class="field-help">Edit or delete your own message. Deletion is a soft delete and cannot be undone from the UI.</div></div><div class="modal-form-actions" style="justify-content:space-between"><button class="danger-button button-small" data-action="delete-message" data-id="${data.id}">${icon('trash-2')} Delete</button><div style="display:flex;gap:8px"><button class="secondary-button button-small" data-action="close-modal">Cancel</button><button class="primary-button button-small" data-action="save-message" data-id="${data.id}">Save edit</button></div></div>`);
}
async function saveMessageEdit(id) {
  const body=$('#edit-message-body').value.trim();if(!body)return toast('Message is empty','Enter some text or delete the message instead.','error');
  const {error}=await state.supabase.from('messages').update({body,edited_at:new Date().toISOString()}).eq('id',id).eq('sender_id',state.user.id);if(error)throw error;closeModal();await loadChatMessages();toast('Message edited','Your changes have been saved.');
}
async function deleteMessage(id) {
  if(!confirm('Delete this message?'))return;const {error}=await state.supabase.from('messages').update({deleted_at:new Date().toISOString(),body:'',attachment_path:null,attachment_mime:null}).eq('id',id).eq('sender_id',state.user.id);if(error)throw error;closeModal();await loadChatMessages();toast('Message deleted','The message has been removed from the conversation.');
}
async function signOut() { await stopChannels(); if(state.supabase){const {error}=await state.supabase.auth.signOut();if(error)throw error;}state.user=null;state.profile=null;state.members=[];state.presenceIds.clear();state.activeConversationId=null;state.groupConversationId=null;stopChatChannel();showLogin();showAuthMessage('');setConnection('', 'Not connected'); }

// Global delegated interactions keep markup declarative and avoid duplicate handlers.
document.addEventListener('click', event => {
  const pageButton=event.target.closest('[data-page]');
  if(pageButton){event.preventDefault();navigate(pageButton.dataset.page);return;}
  const actionButton=event.target.closest('[data-action]');
  if(actionButton){event.preventDefault();const action=actionButton.dataset.action;if(action==='save-message')handleAction('save-message',actionButton);else if(action==='delete-message')handleAction('delete-message',actionButton);else handleAction(action,actionButton);}
});
// Handle the two message actions separately so asynchronous failures remain visible.
document.addEventListener('click', event => {
  const el=event.target.closest('[data-action="save-message"],[data-action="delete-message"]');if(!el)return;
  const run=el.dataset.action==='save-message'?saveMessageEdit(el.dataset.id):deleteMessage(el.dataset.id);Promise.resolve(run).catch(error=>toast('Message update failed',cleanError(error),'error'));
});
$('#modal-close').addEventListener('click',closeModal);
$('#modal-backdrop').addEventListener('click',event=>{if(event.target===$('#modal-backdrop'))closeModal();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal();if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(state.user)showSearchModal();}});
$('#topbar-search').addEventListener('click',showSearchModal);
$('#sidebar-open').addEventListener('click',()=>$('#sidebar').classList.add('open'));
$('#sidebar-close').addEventListener('click',()=>$('#sidebar').classList.remove('open'));
$('#logout-button').addEventListener('click',()=>signOut().catch(error=>toast('Could not sign out',cleanError(error),'error')));
$$('[data-toggle-password]').forEach(button=>button.addEventListener('click',()=>{const input=$(`#${button.dataset.togglePassword}`);input.type=input.type==='password'?'text':'password';button.setAttribute('aria-label',input.type==='password'?'Show password':'Hide password');button.innerHTML=icon(input.type==='password'?'eye':'eye-off');refreshIcons();}));
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!state.supabase){showAuthMessage('Add the Supabase URL and publishable key in js/config.js first.');return;}
  const button=$('#login-submit');button.disabled=true;button.querySelector('span').textContent='Signing you in…';showAuthMessage('');
  try{const email=$('#login-email').value.trim();const password=$('#login-password').value;const {error}=await state.supabase.auth.signInWithPassword({email,password});if(error)throw error;showAuthMessage('Signed in. Checking your squad access…','success');}
  catch(error){showAuthMessage(cleanError(error,'Sign-in failed. Check your details and try again.'));}
  finally{button.disabled=false;button.querySelector('span').textContent='Enter CODSQUAD';}
});
$('#forgot-password').addEventListener('click',async()=>{
  if(!state.supabase)return showAuthMessage('Connect Supabase first using js/config.js.');const email=$('#login-email').value.trim();if(!email)return showAuthMessage('Enter your email address first, then select Forgot password?');
  try{const redirectTo=`${location.origin}${location.pathname}?reset=1`;const {error}=await state.supabase.auth.resetPasswordForEmail(email,{redirectTo});if(error)throw error;showAuthMessage('Password-reset instructions have been requested. Check your email inbox.','success');}
  catch(error){showAuthMessage(cleanError(error));}
});
window.addEventListener('popstate',()=>{const page=location.hash.replace(/^#/,'')||'dashboard';if(state.user)navigate(page,{replace:true});});
window.addEventListener('hashchange',()=>{if(state.user){const page=location.hash.replace(/^#/,'');if(PAGE_NAMES[page]&&page!==state.page)navigate(page,{replace:true});}});

async function boot() {
  refreshIcons();
  const configured=isSupabaseConfigured();
  $('#config-notice').classList.toggle('hidden',configured);
  if(!configured){$('#login-submit').disabled=true;$('#login-submit').title='Configure Supabase in js/config.js first';setConnection('error','Setup needed');showLogin();return;}
  try{
    state.supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true},global:{headers:{'x-application-name':'codsquad'}}});
    state.supabase.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{if(session?.user){if(state.user?.id!==session.user.id || !state.profile)enterApp(session);}else if(event==='SIGNED_OUT'){state.user=null;state.profile=null;showLogin();setConnection('', 'Not connected');}},0);});
    const {data,error}=await state.supabase.auth.getSession();if(error)throw error;
    const recoveryFlow = location.hash.includes('type=recovery') || location.hash === '#reset-password' || new URLSearchParams(location.search).has('reset');
    if(data.session) { await enterApp(data.session); if (recoveryFlow && state.profile) { state.settingsTab='security'; navigate('settings',{replace:true}); toast('Recovery link confirmed','Choose a new password in Account security.'); } }
    else { setConnection('', 'Sign in to connect'); showLogin(); if(recoveryFlow) showAuthMessage('Open the password-reset email link again if it has expired, then sign in with your new password.','success'); }
  }catch(error){console.error(error);showLogin();setConnection('error','Connection issue');showAuthMessage(cleanError(error));}
}
boot();
