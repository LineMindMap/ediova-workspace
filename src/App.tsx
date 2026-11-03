import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import PaymentCenter from './PaymentCenter';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight,
  Clock3, ExternalLink, FileText, LayoutDashboard, Link as LinkIcon, LockKeyhole, LogOut,
  BarChart3, Bell, BellRing, MessageCircle, MoreHorizontal, NotebookPen, Plus, Repeat, Search, ShieldCheck, Sparkles, Target, Trash2, UserRound, Users, Wallet, X,
  Copy, Save, Share2, Bold, Italic, Underline, List, ListOrdered, AlignLeft, AlignCenter,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type Role = 'manager' | 'managing_director';
type Status = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'archived';
type RepeatUnit = 'none' | 'daily' | 'weekly' | 'monthly';
type Priority = 'low' | 'normal' | 'high' | 'urgent';
type View = 'dashboard' | 'tasks' | 'calendar' | 'completed' | 'performance' | 'profile' | 'templates' | 'payments' | 'policies' | 'privacy';
type Profile = { id: string; full_name: string; role: Role; location?: string | null; experience?: string | null };
type TeamMember = { id: string; full_name: string; job_title: string; location: string; sort_order: number; profile_id?: string | null };
type CompanyNotice = { id: string; title: string; body: string; created_by: string; created_at: string; is_active: boolean; expires_at?: string | null };
type UserNote = { id: string; user_id: string; title: string; body: string; reminder_date: string | null; completed_at: string | null; popup_dismissed_on: string | null; created_at: string; updated_at: string };
type PerformanceRow = { manager_id: string; manager_name: string; location?: string | null; assigned_tasks: number; completed_tasks: number; delayed_tasks: number; penalty_points: number; performance_score: number };
type MonthlyPerformanceRow = { manager_id: string; manager_name: string; location?: string | null; month_start: string; completed_tasks: number; completed_hours: number };
type DailyPerformanceRow = { manager_id: string; manager_name: string; location?: string | null; selected_date: string; completed_tasks: number; completed_hours: number };
type RepeatMonthlyCount = 1 | 2;
type Task = {
  id: string; title: string; description: string; scheduled_at: string; deadline_at: string;
  priority: Priority; status: Status; resource_url?: string | null; resource_urls?: string[]; assignee_id?: string | null;
  created_by?: string | null; completed_at?: string | null; updated_at?: string;
  repeat_unit?: RepeatUnit; repeat_every?: number; repeat_until?: string | null; recurrence_parent_id?: string | null;
  repeat_monthly_count?: RepeatMonthlyCount; repeat_day_one?: number | null; repeat_day_two?: number | null;
  repeat_weekdays?: number[];
};
type Comment = { id: string; task_id: string; author_id: string; body: string; created_at: string; author_name?: string };
type Draft = { title: string; description: string; scheduled: string; deadline: string; priority: Priority; resource: string; assignee: string; repeatUnit: RepeatUnit; repeatEvery: number; repeatUntil: string; repeatMonthlyCount: RepeatMonthlyCount; repeatDayOne: number; repeatDayTwo: number; repeatDays: number[]; targetHours: string; startNow: boolean };
type TemplateCategory = 'task' | 'notice' | 'invoice' | 'general';
type WorkspaceTemplate = { id: string; title: string; category: TemplateCategory; body_html: string; is_shared?: boolean; created_by?: string; created_at?: string; updated_at?: string };
const TEMPLATE_KEY = 'ediova-workspace-templates-v1';
const BUILT_IN_TEMPLATES: WorkspaceTemplate[] = [
  { id: 'builtin-video-brief', title: 'Video editing task brief', category: 'task', is_shared: true, created_by: 'builtin', body_html: '<h2>Video Editing Brief</h2><p><strong>Project:</strong> [Project / client name]</p><p><strong>Deliverables</strong></p><ul><li>Format and aspect ratio: [16:9 / 9:16 / 1:1]</li><li>Target duration: [duration]</li><li>Reference links: [paste links]</li><li>Brand assets: [folder link]</li></ul><p><strong>Style and direction</strong></p><p>[Pacing, captions, music, transitions, color, and other creative direction]</p><p><strong>Review notes:</strong> [revision requirements]</p><p><strong>Deadline:</strong> [date and time, Pakistan Standard Time]</p>' },
  { id: 'builtin-thumbnail-brief', title: 'Thumbnail / cover design brief', category: 'task', is_shared: true, created_by: 'builtin', body_html: '<h2>Thumbnail / Cover Brief</h2><p><strong>Project:</strong> [Project name]</p><p><strong>Platform and size:</strong> [YouTube / Instagram / other]</p><p><strong>Main message:</strong> [headline or hook]</p><p><strong>Required elements</strong></p><ul><li>Subject / person: [details]</li><li>Brand colors and fonts: [details]</li><li>Images and references: [links]</li></ul><p><strong>Export:</strong> [file type and dimensions]</p><p><strong>Deadline:</strong> [date]</p>' },
  { id: 'builtin-project-handoff', title: 'Project handoff checklist', category: 'task', is_shared: true, created_by: 'builtin', body_html: '<h2>Project Handoff</h2><p><strong>Project:</strong> [Project name]</p><ul><li>Final exports uploaded</li><li>Editable project files included</li><li>Fonts, assets, and linked media included</li><li>File names and versions checked</li><li>Quality check completed</li><li>Delivery links tested</li></ul><p><strong>Delivery folder:</strong> [link]</p><p><strong>Notes for the next owner:</strong> [notes]</p>' },
  { id: 'builtin-team-notice', title: 'Team notice / announcement', category: 'notice', is_shared: true, created_by: 'builtin', body_html: '<h2>Team Announcement</h2><p>Hello team,</p><p>[Write the key update or announcement here.]</p><p><strong>What this means:</strong> [impact or next steps]</p><p><strong>Action required:</strong> [owner and deadline, if applicable]</p><p>Thank you,<br>Ediova Management</p>' },
  { id: 'builtin-invoice', title: 'Video editing invoice', category: 'invoice', is_shared: true, created_by: 'builtin', body_html: '<h1>INVOICE</h1><p><strong>Invoice no.:</strong> EDI-[YYYY]-[###]<br><strong>Issue date:</strong> [date]<br><strong>Due date:</strong> [date]</p><hr><p><strong>From:</strong> Ediova<br><strong>Bill to:</strong> [Client / company]</p><table><thead><tr><th align="left">Description</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amount</th></tr></thead><tbody><tr><td>[Editing / production service]</td><td>1</td><td>[Currency and amount]</td><td>[Currency and amount]</td></tr></tbody></table><p><strong>Subtotal:</strong> [amount]<br><strong>Tax / fees:</strong> [amount]<br><strong>Total due:</strong> [amount]</p><p><strong>Payment terms:</strong> [terms]<br><strong>Payment instructions:</strong> [details]</p><p>Thank you for working with Ediova.</p>' },
  { id: 'builtin-payment-followup', title: 'Invoice payment follow-up', category: 'invoice', is_shared: true, created_by: 'builtin', body_html: '<h2>Invoice Follow-up</h2><p>Hi [Client name],</p><p>I hope you are well. This is a friendly follow-up regarding invoice <strong>[invoice number]</strong> for <strong>[amount]</strong>, due on <strong>[date]</strong>.</p><p>Please let us know if you need another copy or any clarification. Thank you for your continued partnership.</p><p>Best regards,<br>Ediova</p>' },
];
function isBuiltInTemplate(template: WorkspaceTemplate) { return template.id.startsWith('builtin-'); }
function sanitizeTemplateHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const allowedTags = new Set(['P','BR','STRONG','B','EM','I','U','UL','OL','LI','H1','H2','H3','BLOCKQUOTE','SPAN','DIV','TABLE','THEAD','TBODY','TR','TH','TD','A','HR']);
  const allowedStyles = new Set(['color','background-color','font-weight','font-style','text-decoration','text-align','font-size']);
  const removeNodes = Array.from(parsed.body.querySelectorAll('script,style,iframe,object,embed,svg,math,form,input,button,video,audio,link,meta'));
  removeNodes.forEach(node => node.remove());
  Array.from(parsed.body.querySelectorAll('*')).forEach(node => {
    if (!allowedTags.has(node.tagName)) {
      const parent = node.parentNode;
      if (parent) { while (node.firstChild) parent.insertBefore(node.firstChild, node); parent.removeChild(node); }
      return;
    }
    Array.from(node.attributes).forEach(attr => {
      if (attr.name === 'style') {
        const rules = attr.value.split(';').map(rule => rule.trim()).filter(Boolean).map(rule => {
          const split = rule.indexOf(':');
          if (split < 0) return '';
          const name = rule.slice(0, split).trim().toLowerCase();
          const value = rule.slice(split + 1).trim();
          if (!allowedStyles.has(name) || /url\s*\(|expression\s*\(|javascript:/i.test(value)) return '';
          return name + ':' + value;
        }).filter(Boolean);
        if (rules.length) node.setAttribute('style', rules.join(';')); else node.removeAttribute('style');
      } else if (node.tagName === 'A' && (attr.name === 'href' || attr.name === 'title')) {
        if (attr.name === 'href' && !/^(https?:|mailto:)/i.test(attr.value)) node.removeAttribute(attr.name);
      } else node.removeAttribute(attr.name);
    });
  });
  return parsed.body.innerHTML;
}
function templatePlainText(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return (new DOMParser().parseFromString(sanitizeTemplateHtml(html), 'text/html').body.textContent || '').replace(/\u00a0/g, ' ').trim();
}

const managerDemo: Profile = { id: 'demo-manager', full_name: 'Umna Haroon', role: 'manager', location: 'Islamabad, Pakistan', experience: '2+ years' };
const directorDemo: Profile = { id: 'demo-director', full_name: 'Hamza Mubarak', role: 'managing_director', location: 'Yogyakarta, Indonesia' };
const TEAM_FALLBACK: TeamMember[] = [
  { id: 'hamza-mubarak', full_name: 'Hamza Mubarak', job_title: 'Managing Director', location: 'Yogyakarta, Indonesia', sort_order: 1, profile_id: 'f47dccdf-0da3-45c6-85bd-9f6401872692' },
  { id: 'humna-haroon', full_name: 'Humna Haroon', job_title: 'Manager', location: 'Islamabad, Pakistan', sort_order: 2, profile_id: 'b46129c6-cbf4-4d47-8d84-f592e36645f8' },
  { id: 'syed-shaheer', full_name: 'Syed Shaheer', job_title: 'Senior Video Editor', location: 'Faisalabad, Pakistan', sort_order: 3 },
  { id: 'muhammad-hammad', full_name: 'Muhammad Hammad', job_title: 'Anime Expert', location: 'Aceh, Indonesia', sort_order: 4 },
  { id: 'ahmer-munir', full_name: 'Ahmer Munir', job_title: 'Truvision Studio', location: 'Hafizabad, Pakistan', sort_order: 5 },
  { id: 'ahmer-khan', full_name: 'Ahmer Khan', job_title: 'Junior Video Editor', location: 'Karachi, Pakistan', sort_order: 6 },
  { id: 'salman-asghar', full_name: 'Salman Asghar', job_title: 'Journal Writing', location: 'Sialkot, Pakistan', sort_order: 7 },
];
const TASK_KEY = 'ediova-workspace-demo-tasks-v1';
const COMMENT_KEY = 'ediova-workspace-demo-comments-v1';
const NOTES_KEY = 'ediova-workspace-private-notes-v1';
const hour = (n: number) => new Date(Date.now() + n * 3600000).toISOString();
const demoTasks = (): Task[] => [
  { id: 'demo-1', title: 'Polish the brand presentation', description: 'Review the latest brand presentation, refine the opening slides, and make the visual rhythm consistent from start to finish. Check typography, transitions and the final call to action.', scheduled_at: hour(-8), deadline_at: hour(9), priority: 'high', status: 'in_progress', resource_url: 'https://ediova.com' },
  { id: 'demo-2', title: 'Prepare the client cut list', description: 'Compile requested edits, group notes by scene, and flag any feedback that needs clarification before the next editing pass.', scheduled_at: hour(-3), deadline_at: hour(22), priority: 'normal', status: 'pending' },
  { id: 'demo-3', title: 'Share the weekly project recap', description: 'Summarise deliverables, pending decisions and next milestones. Add relevant links so the team can review everything in one place.', scheduled_at: hour(-38), deadline_at: hour(-12), priority: 'urgent', status: 'pending' },
  { id: 'demo-4', title: 'Schedule the campaign edits', description: 'Collect approved exports, confirm destination links, and prepare the publishing schedule for the upcoming campaign.', scheduled_at: hour(25), deadline_at: hour(50), priority: 'normal', status: 'pending', resource_url: 'https://example.com/brief' },
  { id: 'demo-5', title: 'Export final motion versions', description: 'Export approved motion assets in the requested aspect ratios and confirm filenames and delivery folders.', scheduled_at: hour(-95), deadline_at: hour(-75), priority: 'low', status: 'completed', completed_at: hour(-76) },
];
function parseLinks(value?: string | null) {
  return (value || '').split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
}
function fromDatabaseTask(row: Record<string, unknown>): Task {
  const links = Array.isArray(row.links) ? row.links.filter((item): item is string => typeof item === 'string') : [];
  const normalizedLinks = links.length ? links : (typeof row.resource_url === 'string' ? [row.resource_url] : []);
  return {
    ...(row as unknown as Task),
    scheduled_at: String(row.schedule_at ?? row.scheduled_at ?? ''),
    priority: (row.priority === 'medium' ? 'normal' : row.priority) as Priority,
    status: row.status as Status,
    resource_urls: normalizedLinks,
    resource_url: normalizedLinks[0] || null,
    repeat_unit: (row.repeat_unit ?? 'none') as RepeatUnit,
    repeat_every: Number(row.repeat_every ?? 1),
    repeat_weekdays: Array.isArray(row.repeat_weekdays) ? row.repeat_weekdays.map(Number).filter((day: number) => Number.isInteger(day) && day >= 1 && day <= 7) : [],
    repeat_until: typeof row.repeat_until === 'string' ? row.repeat_until : null,
    recurrence_parent_id: typeof row.recurrence_parent_id === 'string' ? row.recurrence_parent_id : null,
    repeat_monthly_count: Number(row.repeat_monthly_count ?? 1) === 2 ? 2 : 1,
    repeat_day_one: row.repeat_day_one == null ? null : Number(row.repeat_day_one),
    repeat_day_two: row.repeat_day_two == null ? null : Number(row.repeat_day_two),
  };
}
function toDatabaseTask(changes: { title: string; description: string; scheduled_at: string; deadline_at: string; priority: Priority; resource_url: string | null; assignee_id: string; repeat_unit: RepeatUnit; repeat_every: number; repeat_until: string | null; repeat_monthly_count: RepeatMonthlyCount; repeat_day_one: number | null; repeat_day_two: number | null; repeat_weekdays: number[] }): Record<string, unknown> {
  const { scheduled_at, priority, resource_url, ...rest } = changes;
  return {
    ...rest,
    schedule_at: scheduled_at,
    priority: priority === 'normal' ? 'medium' : priority,
    links: parseLinks(resource_url),
  };
}
function safeRead<T>(key: string, fallback: () => T): T {
  try { const data = localStorage.getItem(key); return data ? JSON.parse(data) as T : fallback(); } catch { return fallback(); }
}
function karachiParts(date: Date, weekday = false) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', ...(weekday ? { weekday: 'short' } : {}) }).formatToParts(date);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}
function keyFor(value: string | Date) {
  const parts = karachiParts(value instanceof Date ? value : new Date(value));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
function todayKey() { return keyFor(new Date()); }
function dayOffset(value: string) {
  const [todayYear, todayMonth, todayDay] = todayKey().split('-').map(Number);
  const [year, month, day] = keyFor(value).split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86400000);
}
function dayHeading(offset: number) {
  if (offset < 0) return 'Past due';
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return 'In ' + offset + ' days';
}
function daySubheading(offset: number) {
  if (offset < 0) return 'Needs attention';
  if (offset === 0) return 'Your focus for today';
  if (offset === 1) return 'Prepare for tomorrow';
  return 'Coming up next';
}
function dateLabel(value?: string | null, time = false) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value));
}
function longDate() { return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()); }
function inputInKarachi(value?: string) {
  if (!value) return '';
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const o = Object.fromEntries(p.map(x => [x.type, x.value]));
  return o.year + '-' + o.month + '-' + o.day + 'T' + o.hour + ':' + o.minute;
}
function fromKarachiInput(value: string) { return new Date(value + ':00+05:00').toISOString(); }
function weekdayFor(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
function nextKarachiMidnightInput() {
  const parts = karachiParts(new Date());
  const nextDay = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
  const date = nextDay.getUTCFullYear() + '-' + String(nextDay.getUTCMonth() + 1).padStart(2, '0') + '-' + String(nextDay.getUTCDate()).padStart(2, '0');
  return date + 'T00:00';
}
function firstSelectedWeekdayInput(value: string, days: number[]) {
  if (!days.length) return value;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const time = value.slice(11, 16) || '00:00';
  const date = new Date(Date.UTC(year, month - 1, day));
  for (let offset = 0; offset < 7; offset += 1) {
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if (days.includes(weekday)) {
      const formatted = date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
      return formatted + 'T' + time;
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return value;
}
function defaultTaskDraft(): Draft {
  const scheduled = nextKarachiMidnightInput();
  return {
    title: '', description: '', scheduled, deadline: scheduled.slice(0, 10) + 'T23:59',
    priority: 'normal', resource: '', assignee: '', repeatUnit: 'none', repeatEvery: 1, repeatUntil: '',
    repeatMonthlyCount: 1, repeatDayOne: 15, repeatDayTwo: 28, repeatDays: [weekdayFor(scheduled)], targetHours: '', startNow: false,
  };
}
function effectiveStatus(task: Task): string {
  if (task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'archived' && new Date(task.deadline_at).getTime() < Date.now()) return 'overdue';
  return task.status;
}
function roleLabel(role: Role) { return role === 'manager' ? 'Manager' : 'Managing Director'; }
function priorityLabel(priority: Priority) { return priority[0].toUpperCase() + priority.slice(1); }
function loginFailureMessage(message?: string) {
  const value = (message || '').toLowerCase();
  if (/invalid login credentials|invalid email or password|wrong password|email or password/.test(value)) return 'The email address or password is incorrect. Check your details and try again.';
  if (/email not confirmed|email confirmation/.test(value)) return 'Please confirm your email address before signing in.';
  if (/rate limit|too many requests/.test(value)) return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  if (/network|fetch|failed to fetch/.test(value)) return 'We could not reach the sign-in service. Check your connection and try again.';
  return 'We could not sign you in. Check your details and try again. Contact the Managing Director if the issue continues.';
}
function resourceHostLabel(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return 'Open task resource'; }
}

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'login' | 'workspace'>('landing');
  const [selectedTaskDay, setSelectedTaskDay] = useState(0);
  const [logoTransition, setLogoTransition] = useState(false);
  const [teamDirectory, setTeamDirectory] = useState<TeamMember[]>(TEAM_FALLBACK);
  const [teamModal, setTeamModal] = useState(false);
  const [dashboardNotice, setDashboardNotice] = useState<CompanyNotice | null>(null);
  const [noticeComposer, setNoticeComposer] = useState(false);
  const [noticeTitleDraft, setNoticeTitleDraft] = useState('');
  const [noticeBodyDraft, setNoticeBodyDraft] = useState('');
  const [performanceRows, setPerformanceRows] = useState<PerformanceRow[]>([]);
  const [monthlyPerformanceRows, setMonthlyPerformanceRows] = useState<MonthlyPerformanceRow[]>([]);
  const [dailyPerformanceRows, setDailyPerformanceRows] = useState<DailyPerformanceRow[]>([]);
  const [performanceMonth, setPerformanceMonth] = useState(() => todayKey().slice(0, 7));
  const [performanceCalendarMonth, setPerformanceCalendarMonth] = useState(() => { const p = todayKey().split('-').map(Number); return new Date(p[0], p[1] - 1, 1); });
  const [performanceSelectedDate, setPerformanceSelectedDate] = useState(() => todayKey());
  const [directorTaskHours, setDirectorTaskHours] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [team, setTeam] = useState<Profile[]>([]);
  const [tasks, setTasks] = useState<Task[]>(() => safeRead(TASK_KEY, demoTasks));
  const [comments, setComments] = useState<Comment[]>(() => safeRead(COMMENT_KEY, () => []));
  const [view, setView] = useState<View>('dashboard');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [calendarMonth, setCalendarMonth] = useState(() => { const a = todayKey().split('-').map(Number); return new Date(a[0], a[1] - 1, 1); });
  const [flip, setFlip] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [draft, setDraft] = useState<Draft>(() => defaultTaskDraft());
  const [taskPendingDelete, setTaskPendingDelete] = useState<Task | null>(null);
  const [userNotes, setUserNotes] = useState<UserNote[]>([]);
  const [currentDateKey, setCurrentDateKey] = useState(() => todayKey());
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [noteEditing, setNoteEditing] = useState<UserNote | null>(null);
  const [noteTitleDraft, setNoteTitleDraft] = useState('');
  const [noteBodyDraft, setNoteBodyDraft] = useState('');
  const [noteReminderDateDraft, setNoteReminderDateDraft] = useState('');
  const [reminderPopupOpen, setReminderPopupOpen] = useState(false);
  const [reminderPopupDismissedForDate, setReminderPopupDismissedForDate] = useState('');
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>(BUILT_IN_TEMPLATES);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<'all' | TemplateCategory>('all');
  const [templateSelectedId, setTemplateSelectedId] = useState('builtin-video-brief');
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateEditing, setTemplateEditing] = useState<WorkspaceTemplate | null>(null);
  const [templateTitleDraft, setTemplateTitleDraft] = useState('');
  const [templateCategoryDraft, setTemplateCategoryDraft] = useState<TemplateCategory>('task');
  const [templateSharedDraft, setTemplateSharedDraft] = useState(true);
  const [templateBodyDraft, setTemplateBodyDraft] = useState('');
  const templateEditorRef = useRef<HTMLDivElement | null>(null);

  const role = profile?.role || 'manager';
  const director = role === 'managing_director';
  const preview = !isSupabaseConfigured || !session;
  const todayReminderNotes = userNotes.filter(note => note.reminder_date === currentDateKey && !note.completed_at);
  const popupReminderNotes = todayReminderNotes.filter(note => note.popup_dismissed_on !== currentDateKey);
  const dashboardReminders = userNotes.filter(note => Boolean(note.reminder_date) && (note.reminder_date as string) <= currentDateKey && !note.completed_at)
    .sort((a, b) => (a.reminder_date || '').localeCompare(b.reminder_date || '') || b.created_at.localeCompare(a.created_at));
  const openPersonalNotesCount = userNotes.filter(note => !note.completed_at).length;

  function notify(message: string) { setNotice(message); window.setTimeout(() => setNotice(''), 3600); }
  async function beginLoginTransition() {
    if (logoTransition || loading) return;
    setLoginError('');
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          setScreen('login');
          setLoginError('We could not verify your existing session. Please sign in again.');
          return;
        }
        if (data.session) { await openSession(data.session); return; }
      } catch {
        setScreen('login');
        setLoginError('We could not check your sign-in status. Please try again.');
        return;
      }
    }
    setLoginEmail(''); setLoginPassword('');
    setLogoTransition(true);
    window.setTimeout(() => {
      setScreen('login');
      setLogoTransition(false);
    }, 900);
  }
  async function refreshTasks() {
    if (!session || !supabase) return;
    const { data, error } = await supabase.from('tasks').select('*').order('schedule_at', { ascending: true });
    if (!error && data) setTasks((data || []).map(row => fromDatabaseTask(row as unknown as Record<string, unknown>)));
    else if (error) notify('Tasks could not refresh. Please try again.');
    if (profile?.role === 'managing_director') {
      const { data: hourRows, error: hourError } = await supabase.from('task_hour_targets').select('task_id,target_hours');
      if (!hourError && hourRows) setDirectorTaskHours(Object.fromEntries(hourRows.map((row: { task_id: string; target_hours: number | string }) => [row.task_id, Number(row.target_hours)])));
    }
  }
  async function openSession(next: Session) {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('id,full_name,role,location,experience').eq('id', next.user.id).single();
    if (error || !data || (data.role !== 'manager' && data.role !== 'managing_director')) {
      await supabase.auth.signOut();
      setLoading(false);
      setLoginError('This account is not set up for the Ediova workspace. Please contact the Managing Director.');
      setScreen('login');
      return;
    }
    setLoginError(''); setLoginEmail(''); setLoginPassword('');
    setSession(next); setProfile(data as Profile);
    setUserNotes([]); setReminderPopupOpen(false); setReminderPopupDismissedForDate('');
    const { data: personalNotes, error: personalNotesError } = await supabase.from('user_notes').select('*').order('created_at', { ascending: false });
    if (personalNotesError) notify('Your private Notepad could not load: ' + personalNotesError.message);
    else setUserNotes((personalNotes || []) as UserNote[]);
    const { data: people } = await supabase.from('profiles').select('id,full_name,role,location,experience');
    setTeam((people || []) as Profile[]);
    const { data: directoryRows } = await supabase.from('team_directory').select('id,full_name,job_title,location,sort_order,profile_id').order('sort_order');
    if (directoryRows?.length) setTeamDirectory(directoryRows as TeamMember[]);
    const { data: noticeRows } = await supabase.from('company_notices').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1);
    setDashboardNotice((noticeRows?.[0] as CompanyNotice | undefined) || null);
    const { data: templateRows, error: templateError } = await supabase.from('workspace_templates').select('*').order('updated_at', { ascending: false });
    if (templateError) notify('Template library could not load: ' + templateError.message);
    else {
      const savedTemplates = (templateRows || []) as WorkspaceTemplate[];
      setTemplates([...BUILT_IN_TEMPLATES, ...savedTemplates]);
      setTemplateSelectedId(savedTemplates[0]?.id || BUILT_IN_TEMPLATES[0].id);
    }
    const { data: rows, error: taskError } = await supabase.from('tasks').select('*').order('schedule_at', { ascending: true });
    if (taskError) notify('Workspace opened, but tasks could not load.');
    else setTasks((rows || []).map(row => fromDatabaseTask(row as unknown as Record<string, unknown>)));
    if (data.role === 'managing_director') {
      const { data: hourRows, error: hourError } = await supabase.from('task_hour_targets').select('task_id,target_hours');
      if (hourError) notify('Private task-hour targets could not be loaded.');
      else setDirectorTaskHours(Object.fromEntries((hourRows || []).map((row: { task_id: string; target_hours: number | string }) => [row.task_id, Number(row.target_hours)])));
    } else {
      setDirectorTaskHours({});
    }
    setComments([]);
    setScreen('workspace'); setLoading(false);
  }
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active && data.session) void openSession(data.session); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (preview) {
      try { localStorage.setItem(TASK_KEY, JSON.stringify(tasks)); localStorage.setItem(COMMENT_KEY, JSON.stringify(comments)); } catch { /* storage is optional */ }
    }
  }, [tasks, comments, preview]);
  useEffect(() => {
    if (preview && profile) {
      try { localStorage.setItem(NOTES_KEY + ':' + profile.id, JSON.stringify(userNotes)); } catch { /* storage is optional */ }
    }
  }, [userNotes, profile?.id, preview]);
  useEffect(() => {
    if (preview && profile) {
      try { localStorage.setItem(TEMPLATE_KEY + ':' + profile.id, JSON.stringify(templates)); } catch { /* storage is optional */ }
    }
  }, [templates, profile?.id, preview]);
  useEffect(() => {
    if (templateEditorOpen && templateEditorRef.current) {
      templateEditorRef.current.innerHTML = sanitizeTemplateHtml(templateBodyDraft);
    }
  }, [templateEditorOpen, templateEditing?.id, templateTitleDraft, templateCategoryDraft]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDateKey(todayKey()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!session || !supabase) return;
    const timer = window.setInterval(() => {
      void refreshTasks();
      if (supabase) {
        void supabase.from('company_notices').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1)
          .then(({ data }) => setDashboardNotice((data?.[0] as CompanyNotice | undefined) || null));
      }
      setActiveTaskId(value => value);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (screen !== 'workspace' || !profile || popupReminderNotes.length === 0 || reminderPopupDismissedForDate === currentDateKey) {
      setReminderPopupOpen(false);
      return;
    }
    setReminderPopupOpen(true);
  }, [screen, profile?.id, popupReminderNotes.length, currentDateKey, reminderPopupDismissedForDate]);
  useEffect(() => {
    if (!session || !supabase || view !== 'performance') return;
    let active = true;
    const refreshPerformance = async () => {
      const [scores, monthly, daily] = await Promise.all([
        supabase!.rpc('get_manager_performance'),
        supabase!.rpc('get_manager_monthly_performance', { p_month: performanceMonth + '-01' }),
        supabase!.rpc('get_manager_daily_performance', { p_date: performanceSelectedDate }),
      ]);
      if (active && !scores.error && scores.data) {
        setPerformanceRows([...(scores.data as PerformanceRow[])].sort((a, b) => a.performance_score - b.performance_score));
      }
      if (active && !monthly.error && monthly.data) setMonthlyPerformanceRows(monthly.data as MonthlyPerformanceRow[]);
      if (active && !daily.error && daily.data) setDailyPerformanceRows(daily.data as DailyPerformanceRow[]);
    };
    void refreshPerformance();
    const timer = window.setInterval(() => void refreshPerformance(), 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session, view, performanceMonth, performanceSelectedDate]);
  const released = useMemo(() => tasks.filter(t => director || new Date(t.scheduled_at).getTime() <= Date.now()), [tasks, director]);
  const active = released.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'archived');
  const overdue = active.filter(t => effectiveStatus(t) === 'overdue');
  const currentMonthKey = todayKey().slice(0, 7);
  const activeThisMonth = active.filter(t => keyFor(t.scheduled_at).slice(0, 7) === currentMonthKey);
  const completed = released.filter(t => t.status === 'completed').sort((a, b) => new Date(b.completed_at || b.deadline_at).getTime() - new Date(a.completed_at || a.deadline_at).getTime());
  const visible = useMemo(() => {
    let data = view === 'completed' ? completed : view === 'tasks' ? activeThisMonth.filter(t => dayOffset(t.deadline_at) === selectedTaskDay) : [];

    const q = search.trim().toLowerCase();
    if (q) data = data.filter(t => (t.title + ' ' + t.description).toLowerCase().includes(q));
    if (filter !== 'all') data = data.filter(t => effectiveStatus(t) === filter || t.priority === filter);
    return [...data].sort((a, b) => new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime());
  }, [view, completed, activeThisMonth, selectedTaskDay, search, filter]);
  const activeTask = tasks.find(t => t.id === activeTaskId) || null;
  const todayTasks = active.filter(t => dayOffset(t.scheduled_at) <= 0).sort((a, b) => new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime());
  const nav: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'tasks', label: 'All tasks', icon: Target },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'completed', label: 'Completed', icon: Check },
    { id: 'performance', label: 'Performance', icon: BarChart3 },
    { id: 'profile', label: 'Profile', icon: UserRound },
    { id: 'templates', label: 'Templates', icon: NotebookPen },
    { id: 'payments', label: 'Payments', icon: Wallet },
  ];

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setLoginError('');
    if (!isSupabaseConfigured || !supabase) {
      setLoginEmail(''); setLoginPassword('');
      setProfile(managerDemo);
      setUserNotes(safeRead(NOTES_KEY + ':' + managerDemo.id, () => []));
      setTemplates(safeRead(TEMPLATE_KEY + ':' + managerDemo.id, () => BUILT_IN_TEMPLATES));
      setTemplateSelectedId('builtin-video-brief');
      setReminderPopupDismissedForDate('');
      setScreen('workspace'); notify('Preview mode — changes stay in this browser only.'); return;
    }
    const email = loginEmail.trim();
    const password = loginPassword;
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email, password,
    });
    if (error || !data.session) { setLoginPassword(''); setLoginError(loginFailureMessage(error?.message)); setLoading(false); return; }
    setLoginEmail(''); setLoginPassword('');
    await openSession(data.session);
  }
  async function logout() {
    if (supabase && session) await supabase.auth.signOut();
    setTemplateEditorOpen(false);
    setProfile(null); setSession(null); setUserNotes([]); setReminderPopupOpen(false); setReminderPopupDismissedForDate(''); setNotepadOpen(false); setActiveTaskId(null); setLoginEmail(''); setLoginPassword(''); setScreen('landing'); setView('dashboard');
  }
  function startCreate() {
    setEditing(null);
    setDraft({ ...defaultTaskDraft(), assignee: team.find(p => p.role === 'manager')?.id || managerDemo.id });
    setComposer(true);
  }
  function startEdit(task: Task) {
    setEditing(task);
    setDraft({
      title: task.title, description: task.description, scheduled: inputInKarachi(task.scheduled_at),
      deadline: inputInKarachi(task.deadline_at), priority: task.priority,
      resource: (task.resource_urls?.length ? task.resource_urls : task.resource_url ? [task.resource_url] : []).join('\n'),
      assignee: task.assignee_id || team.find(p => p.role === 'manager')?.id || managerDemo.id,
      repeatUnit: task.repeat_unit || 'none', repeatEvery: task.repeat_every || 1,
      repeatUntil: task.repeat_until ? inputInKarachi(task.repeat_until) : '',
      repeatMonthlyCount: task.repeat_monthly_count === 2 ? 2 : 1,
      repeatDayOne: task.repeat_day_one || Number(keyFor(task.scheduled_at).split('-')[2]),
      repeatDayTwo: task.repeat_day_two || 28,
      repeatDays: task.repeat_weekdays?.length ? [...task.repeat_weekdays] : [weekdayFor(task.scheduled_at)],
      targetHours: directorTaskHours[task.id] == null ? '' : String(directorTaskHours[task.id]), startNow: false,
    });
    setComposer(true);
  }
  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!director || !profile) return;
    if (draft.repeatUnit === 'weekly' && draft.repeatDays.length === 0) {
      notify('Choose at least one weekday for the weekly repeat.'); return;
    }
    const scheduledInput = draft.startNow ? draft.scheduled : draft.repeatUnit === 'weekly' ? firstSelectedWeekdayInput(draft.scheduled, draft.repeatDays) : draft.scheduled;
    const scheduleShift = new Date(fromKarachiInput(scheduledInput)).getTime() - new Date(fromKarachiInput(draft.scheduled)).getTime();
    const scheduledAt = fromKarachiInput(scheduledInput);
    const deadlineAt = new Date(new Date(fromKarachiInput(draft.deadline)).getTime() + scheduleShift).toISOString();
    if (new Date(deadlineAt).getTime() <= new Date(scheduledAt).getTime()) {
      notify('Deadline must be after the release time.'); return;
    }
    if (draft.repeatUnit !== 'none' && draft.repeatUntil && new Date(fromKarachiInput(draft.repeatUntil)).getTime() <= new Date(scheduledAt).getTime()) {
      notify('Repeat-until must be after the first scheduled occurrence.'); return;
    }
    if (draft.repeatUnit === 'monthly' && draft.repeatMonthlyCount === 2 && draft.repeatDayOne === draft.repeatDayTwo) {
      notify('Choose two different dates for the monthly repeats.'); return;
    }
    const targetHours = draft.targetHours.trim() === '' ? null : Number(draft.targetHours);
    if (targetHours !== null && (!Number.isFinite(targetHours) || targetHours < 0.25 || targetHours > 1000)) {
      notify('Private task hours must be between 0.25 and 1,000.'); return;
    }
    const changes = {
      title: draft.title.trim(), description: draft.description.trim(), scheduled_at: scheduledAt,
      deadline_at: deadlineAt, priority: draft.priority, resource_url: draft.resource.trim() || null,
      assignee_id: draft.assignee || team.find(p => p.role === 'manager')?.id || managerDemo.id,
      repeat_unit: draft.repeatUnit, repeat_every: draft.repeatUnit === 'monthly' ? 1 : draft.repeatEvery,
      repeat_until: draft.repeatUnit !== 'none' && draft.repeatUntil ? fromKarachiInput(draft.repeatUntil) : null,
      repeat_monthly_count: draft.repeatUnit === 'monthly' ? draft.repeatMonthlyCount : 1,
      repeat_day_one: draft.repeatUnit === 'monthly' ? draft.repeatDayOne : null,
      repeat_day_two: draft.repeatUnit === 'monthly' && draft.repeatMonthlyCount === 2 ? draft.repeatDayTwo : null,
      repeat_weekdays: draft.repeatUnit === 'weekly' ? [...draft.repeatDays].sort((a, b) => a - b) : [],
    };
    let savedTask: Task;
    let warning = '';
    if (session && supabase) {
      const databaseChanges = toDatabaseTask(changes);
      if (draft.startNow) Object.assign(databaseChanges, { status: 'in_progress', completed_at: null, completed_by: null });
      const result = editing
        ? await supabase.from('tasks').update(databaseChanges).eq('id', editing.id).select('*').single()
        : await supabase.from('tasks').insert({ ...databaseChanges, status: draft.startNow ? 'in_progress' : 'pending', created_by: profile.id }).select('*').single();
      if (result.error || !result.data) { notify('Could not save task: ' + (result.error?.message || 'please try again')); return; }
      savedTask = fromDatabaseTask(result.data as unknown as Record<string, unknown>);
      if (targetHours !== null) {
        const { error: targetError } = await supabase.from('task_hour_targets').upsert({
          task_id: savedTask.id, target_hours: targetHours, set_by: profile.id, updated_at: new Date().toISOString(),
        }, { onConflict: 'task_id' });
        if (targetError) warning = 'Task saved, but private hours could not be saved: ' + targetError.message;
        else setDirectorTaskHours(prev => ({ ...prev, [savedTask.id]: targetHours }));
      } else if (editing) {
        const { error: targetError } = await supabase.from('task_hour_targets').delete().eq('task_id', savedTask.id);
        if (targetError) warning = 'Task saved, but its previous private hour target could not be cleared: ' + targetError.message;
        else setDirectorTaskHours(prev => { const next = { ...prev }; delete next[savedTask.id]; return next; });
      }
      setTasks(prev => editing ? prev.map(t => t.id === savedTask.id ? savedTask : t) : [...prev, savedTask]);
    } else {
      savedTask = editing
        ? { ...editing, ...changes, ...(draft.startNow ? { status: 'in_progress' as Status, completed_at: null } : {}) }
        : { id: 'local-' + Date.now(), ...changes, status: draft.startNow ? 'in_progress' : 'pending' };
      setTasks(prev => editing ? prev.map(t => t.id === savedTask.id ? savedTask : t) : [...prev, savedTask]);
      setDirectorTaskHours(prev => {
        const next = { ...prev };
        if (targetHours === null) delete next[savedTask.id]; else next[savedTask.id] = targetHours;
        return next;
      });
    }
    setComposer(false);
    notify(warning || (draft.startNow ? 'Task released and started immediately.' : editing ? 'Task updated.' : 'Task scheduled.'));
  }

  async function dismantleSchedule(task: Task) {
    if (!director || task.recurrence_parent_id || !task.repeat_unit || task.repeat_unit === 'none') return;
    const confirmed = window.confirm('Stop this repeating schedule? Future, unfinished occurrences will be removed. Tasks already marked completed will be kept.');
    if (!confirmed) return;
    const nowIso = new Date().toISOString();
    const stoppedFields: Partial<Task> = { repeat_unit: 'none', repeat_every: 1, repeat_until: null, repeat_weekdays: [], repeat_monthly_count: 1, repeat_day_one: null, repeat_day_two: null };
    if (session && supabase && !task.id.startsWith('local-')) {
      const { error: stopError } = await supabase.from('tasks').update(stoppedFields).eq('id', task.id);
      if (stopError) { notify('The schedule could not be stopped: ' + stopError.message); return; }
      const { error: deleteError } = await supabase.from('tasks').delete().eq('recurrence_parent_id', task.id).gt('schedule_at', nowIso).neq('status', 'completed');
      if (deleteError) {
        setTasks(prev => prev.map(item => item.id === task.id ? { ...item, ...stoppedFields, repeat_weekdays: [] } : item));
        notify('The schedule is stopped, but some future occurrences could not be removed: ' + deleteError.message);
        void refreshTasks();
        return;
      }
    }
    const now = Date.now();
    setTasks(prev => prev.map(item => item.id === task.id ? { ...item, ...stoppedFields, repeat_weekdays: [] } : item).filter(item => !(item.recurrence_parent_id === task.id && item.status !== 'completed' && new Date(item.scheduled_at).getTime() > now)));
    notify('Schedule dismantled. Completed tasks have been preserved.');
  }

  function startRepeatingTask(task: Task) {
    startEdit(task);
    const day = Number(keyFor(task.scheduled_at).split('-')[2]) || 1;
    setDraft(current => ({ ...current, repeatUnit: 'monthly', repeatEvery: 1, repeatUntil: '', repeatMonthlyCount: 1, repeatDayOne: day }));
  }

  async function startTaskNow(task: Task) {
    if (!director) { notify('Only the Managing Director can release a task immediately.'); return; }
    const now = new Date().toISOString();
    if (session && supabase) {
      const { data, error } = await supabase.from('tasks').update({ schedule_at: now, status: 'in_progress', completed_at: null, completed_by: null }).eq('id', task.id).select('*').single();
      if (error || !data) { notify('The task could not be started. Please refresh and try again.'); return; }
      const saved = fromDatabaseTask(data as unknown as Record<string, unknown>);
      setTasks(prev => prev.map(item => item.id === task.id ? saved : item));
    } else {
      setTasks(prev => prev.map(item => item.id === task.id ? { ...item, scheduled_at: now, status: 'in_progress', completed_at: null } : item));
    }
    notify('Task released and started. It is now available in today’s workspace.');
  }
  async function setStatus(task: Task, status: Status) {
    if (!director && task.scheduled_at > new Date().toISOString()) return;
    const patch = { status, completed_at: status === 'completed' ? new Date().toISOString() : null };
    if (session && supabase) {
      const { data, error } = await supabase.from('tasks').update({ status }).eq('id', task.id).select('*').single();
      if (error) { notify('Status not saved: ' + error.message); return; }
      const savedTask = fromDatabaseTask(data as unknown as Record<string, unknown>);
      setTasks(prev => prev.map(t => t.id === task.id ? savedTask : t));
    } else {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...patch } : t));
    }
    notify(status === 'completed' ? 'Marked complete. Nice work.' : 'Task status updated.');
  }
  async function deleteTask(task: Task) {
    if (!director) { notify('Only the Managing Director can delete tasks.'); return; }
    const deletedIds = new Set([task.id, ...tasks.filter(item => item.recurrence_parent_id === task.id).map(item => item.id)]);
    if (session && supabase) {
      const { data, error } = await supabase.from('tasks').delete().eq('id', task.id).select('id');
      if (error || !data?.length) { notify('The task could not be deleted. Refresh and try again; contact support if the issue continues.'); return; }
    }
    setTasks(prev => prev.filter(item => !deletedIds.has(item.id)));
    setDirectorTaskHours(prev => { const next = { ...prev }; deletedIds.forEach(id => delete next[id]); return next; });
    setComments(prev => prev.filter(comment => !deletedIds.has(comment.task_id)));
    if (activeTaskId && deletedIds.has(activeTaskId)) setActiveTaskId(null);
    setTaskPendingDelete(null);
    notify('Task deleted successfully.');
  }
  async function loadComments(taskId: string) {
    if (!session || !supabase) return;
    const { data } = await supabase.from('task_comments').select('id,task_id,author_id,body,created_at,profiles(full_name)').eq('task_id', taskId).order('created_at', { ascending: true });
    if (data) setComments(prev => [...prev.filter(c => c.task_id !== taskId), ...data.map((item: any) => ({ ...item, author_name: item.profiles?.full_name || 'Ediova team' })) as Comment[]]);
  }
  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!activeTask || !profile || !commentDraft.trim()) return;
    const body = commentDraft.trim();
    if (session && supabase) {
      const { data, error } = await supabase.from('task_comments').insert({ task_id: activeTask.id, author_id: profile.id, body }).select('*').single();
      if (error) { notify('Comment could not be sent: ' + error.message); return; }
      setComments(prev => [...prev, { ...data, author_name: profile.full_name } as Comment]);
    } else {
      setComments(prev => [...prev, { id: 'comment-' + Date.now(), task_id: activeTask.id, author_id: profile.id, author_name: profile.full_name, body, created_at: new Date().toISOString() }]);
    }
    setCommentDraft('');
  }
  function openTask(task: Task) { setActiveTaskId(task.id); if (director || new Date(task.scheduled_at).getTime() <= Date.now()) void loadComments(task.id); }
  function monthShift(direction: number) { setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + direction, 1)); }
  const monthTitle = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(calendarMonth);
  const firstOffset = (new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay() + 6) % 7;
  const monthDays = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarCells = Array.from({ length: firstOffset + monthDays }, (_, i) => i < firstOffset ? 0 : i - firstOffset + 1);
  const calendarEventsByDate = useMemo(() => {
    const map: Record<string, { id: string; task: Task; isVirtual: boolean; scheduledAt: string }[]> = {};
    const monthKey = calendarMonth.getFullYear() + '-' + String(calendarMonth.getMonth() + 1).padStart(2, '0');
    const visibleTasks = tasks.filter(task => (director || task.assignee_id === profile?.id) && task.status !== 'cancelled' && task.status !== 'archived');
    visibleTasks.filter(task => keyFor(task.scheduled_at).slice(0, 7) === monthKey).forEach(task => {
      const key = keyFor(task.scheduled_at);
      (map[key] ||= []).push({ id: task.id, task, isVirtual: false, scheduledAt: task.scheduled_at });
    });
    const dayNumber = (key: string) => {
      const parts = key.split('-').map(Number);
      return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
    };
    const anchorKeyFor = (date: Date) => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    const today = todayKey();
    visibleTasks.filter(series => !series.recurrence_parent_id && Boolean(series.repeat_unit && series.repeat_unit !== 'none')).forEach(series => {
      const startKey = keyFor(series.scheduled_at);
      const endKey = series.repeat_until ? keyFor(series.repeat_until) : null;
      const startDay = dayNumber(startKey);
      const startParts = startKey.split('-').map(Number);
      const startDate = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
      const mondayAnchor = startDay - ((startDate.getUTCDay() + 6) % 7);
      const interval = Math.max(1, Number(series.repeat_every || 1));
      const taskTime = inputInKarachi(series.scheduled_at).slice(11, 16) || '00:00';
      const deadlineOffset = new Date(series.deadline_at).getTime() - new Date(series.scheduled_at).getTime();
      for (let day = 1; day <= monthDays; day++) {
        const key = anchorKeyFor(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
        if (key <= startKey || key < today || (endKey && key > endKey)) continue;
        const candidateDay = dayNumber(key);
        let matches = false;
        if (series.repeat_unit === 'daily') {
          matches = (candidateDay - startDay) % interval === 0;
        } else if (series.repeat_unit === 'weekly') {
          const weekday = ((new Date(Date.UTC(calendarMonth.getFullYear(), calendarMonth.getMonth(), day)).getUTCDay() + 6) % 7) + 1;
          const weekDelta = Math.floor((candidateDay - mondayAnchor) / 7);
          const allowedWeekday = series.repeat_weekdays?.length ? series.repeat_weekdays.includes(weekday) : weekday === ((startDate.getUTCDay() + 6) % 7) + 1;
          matches = weekDelta >= 0 && weekDelta % interval === 0 && allowedWeekday;
        } else if (series.repeat_unit === 'monthly') {
          const dayOfMonth = day;
          matches = dayOfMonth === Number(series.repeat_day_one || startParts[2]) || (Number(series.repeat_monthly_count || 1) === 2 && dayOfMonth === Number(series.repeat_day_two || 0));
        }
        if (!matches || tasks.some(task => task.recurrence_parent_id === series.id && keyFor(task.scheduled_at) === key)) continue;
        const scheduledAt = fromKarachiInput(key + 'T' + taskTime);
        const virtualTask = { ...series, id: 'virtual-' + series.id + '-' + key, scheduled_at: scheduledAt, deadline_at: new Date(new Date(scheduledAt).getTime() + deadlineOffset).toISOString(), status: 'pending' as Status, completed_at: null, recurrence_parent_id: series.id };
        (map[key] ||= []).push({ id: virtualTask.id, task: series, isVirtual: true, scheduledAt });
      }
    });
    Object.values(map).forEach(items => items.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()));
    return map;
  }, [tasks, calendarMonth, currentDateKey, director, profile?.id]);
  const performanceCalendarFirstOffset = (new Date(performanceCalendarMonth.getFullYear(), performanceCalendarMonth.getMonth(), 1).getDay() + 6) % 7;
  const performanceCalendarDays = new Date(performanceCalendarMonth.getFullYear(), performanceCalendarMonth.getMonth() + 1, 0).getDate();
  const performanceCalendarCells = Array.from({ length: performanceCalendarFirstOffset + performanceCalendarDays }, (_, i) => i < performanceCalendarFirstOffset ? 0 : i - performanceCalendarFirstOffset + 1);
  const performanceCalendarTitle = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(performanceCalendarMonth);
  const selectedDateRows = dailyPerformanceRows.filter(row => director || row.manager_id === profile?.id);
  const selectedDateCompletedTasks = released.filter(task => task.status === 'completed' && Boolean(task.completed_at) && keyFor(task.completed_at as string) === performanceSelectedDate && (director || task.assignee_id === profile?.id)).sort((x, y) => new Date(x.completed_at || '').getTime() - new Date(y.completed_at || '').getTime());
  const selectedDateCompletedCount = preview ? selectedDateCompletedTasks.length : selectedDateRows.reduce((sum, row) => sum + Number(row.completed_tasks || 0), 0);
  const selectedDateCreditedHours = (preview ? selectedDateCompletedTasks.reduce((sum, task) => sum + Number(directorTaskHours[task.id] || 0), 0) : selectedDateRows.reduce((sum, row) => sum + Number(row.completed_hours || 0), 0)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  function shiftPerformanceMonth(direction: number) {
    const next = new Date(performanceCalendarMonth.getFullYear(), performanceCalendarMonth.getMonth() + direction, 1);
    const monthKey = next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');
    const day = Math.min(Number(performanceSelectedDate.slice(8, 10)) || 1, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate());
    setPerformanceCalendarMonth(next); setPerformanceMonth(monthKey); setPerformanceSelectedDate(monthKey + '-' + String(day).padStart(2, '0'));
  }
  function selectPerformanceMonth(value: string) {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    const [year, month] = value.split('-').map(Number);
    const next = new Date(year, month - 1, 1);
    const day = Math.min(Number(performanceSelectedDate.slice(8, 10)) || 1, new Date(year, month, 0).getDate());
    setPerformanceMonth(value); setPerformanceCalendarMonth(next); setPerformanceSelectedDate(value + '-' + String(day).padStart(2, '0'));
  }
  const managerName = team.find(p => p.role === 'manager')?.full_name || 'Umna Haroon';

  if (screen === 'landing') return (
    <main className="landing">
      <header className="site-nav"><a className="brand" href="#" onClick={e => { e.preventDefault(); setScreen('landing'); }}><img src="./ediova-mark.svg" alt="" /><span>ediova<span className="brand-dot">.</span></span></a><nav><a href="#approach">Our approach</a><a href="mailto:careers@ediova.com">Careers <ArrowUpRight size={14} /></a><button className="button button-dark small" onClick={() => beginLoginTransition()}>Workspace login <ArrowRight size={15} /></button></nav></header>
      <section className="hero" id="approach">
        <div className="hero-copy"><span className="eyebrow"><span className="eyebrow-dot" /> CREATIVE PARTNERS FOR WHAT'S NEXT</span><h1>Make it<br /><span>meaningful.</span></h1><p>Ideas shaped with intention. Stories designed to move people. Work that stays with you.</p><div className="hero-actions"><button className="button button-dark" onClick={() => beginLoginTransition()}>Enter the workspace <ArrowRight size={16} /></button><a className="text-link" href="mailto:careers@ediova.com">Explore careers <ArrowUpRight size={15} /></a></div><div className="hero-proof"><div className="avatar-stack"><i>E</i><i>D</i><i>O</i></div><span>Good work happens<br /><strong>when details connect.</strong></span></div></div>
        <div className="hero-art" aria-label="Floating creative project cards">
          <svg className="connector-lines" viewBox="0 0 600 540" aria-hidden="true"><path d="M48 132 C145 132 130 250 248 248 S388 80 500 120"/><path d="M130 420 C200 420 240 340 310 350 S420 450 522 384"/><path d="M270 50 C280 120 340 145 338 216 S460 260 480 302"/></svg>
          <div className="float-card float-peach"><span className="float-index">01 / BRAND</span><div className="mini-sun">✳</div><strong>Make a mark.</strong><small>Brand worlds · 2026</small></div>
          <div className="float-card float-lilac"><span className="float-index">02 / MOTION</span><div className="orb-wrap"><div className="orb" /></div><strong>Motion with meaning.</strong><small>Studio notes · 04:28</small></div>
          <div className="float-card float-sage"><span className="float-index">03 / STORY</span><div className="story-lines"><i /><i /><i /></div><strong>Find the feeling.</strong><small>Fieldwork collection</small></div>
          <div className="floating-pill"><Sparkles size={15} /> made with intent</div>
          <div className="floating-note"><span>✳</span><strong>Creative minds.<br />Connected work.</strong></div>
          <div className="art-caption">A little order.<br />A lot of imagination.</div>
        </div>
      </section>
      <section className="expertise-section"><div className="expertise-heading"><span className="eyebrow">WHAT WE BRING TOGETHER</span><h2>Creative thinking.<br /><em>Considered execution.</em></h2><p>From the first rough idea to the final export, we keep the craft deliberate and the details connected.</p></div><div className="expertise-grid"><article className="expertise-card expertise-brand"><span>01 / IDENTITY</span><div className="expertise-icon">✳</div><h3>Brand &amp; design</h3><p>Distinctive visual systems with a clear point of view.</p></article><article className="expertise-card expertise-motion"><span>02 / MOVEMENT</span><div className="expertise-icon">↗</div><h3>Video &amp; motion</h3><p>Stories shaped with rhythm, feeling and precision.</p></article><article className="expertise-card expertise-systems"><span>03 / DELIVERY</span><div className="expertise-icon">◎</div><h3>Creative operations</h3><p>Calm collaboration, clear ownership and dependable delivery.</p></article></div></section>
      <section className="manifesto"><span>THE E D I O V A WAY</span><h2>Good work isn't noise.<br /><em>It's a feeling that fits.</em></h2><p>We bring the moving parts together — thoughtful craft, clear communication and a little room for the unexpected.</p><div className="manifesto-foot"><span>BRAND / VIDEO / MOTION</span><span>INDEPENDENT BY NATURE <ArrowDownRight size={14} /></span></div></section>
      <footer className="landing-footer"><a className="brand" href="#" onClick={e => { e.preventDefault(); setScreen('landing'); }}><img src="./ediova-mark.svg" alt="" /><span>ediova<span className="brand-dot">.</span></span></a><div className="company-footer-details"><strong>Ediova Inc.</strong><span>Jl. Kaluirang 14,5 · Yogyakarta, Indonesia 55584</span><a href="tel:+6281377012611">+62 (813) 77012611</a></div><div className="footer-contact"><a href="mailto:careers@ediova.com">Careers <ArrowUpRight size={14} /></a><a href="mailto:hello@ediova.com">Say hello <ArrowUpRight size={14} /></a><button onClick={() => beginLoginTransition()}>Team login <ArrowRight size={14} /></button></div><span className="copyright">© {new Date().getFullYear()} Ediova Inc. All rights reserved.</span></footer>
      {logoTransition && <div className="brand-loading" role="status" aria-live="polite"><div className="loading-logo-wrap"><img src="./ediova-mark.svg" alt="Ediova" /></div><strong>Preparing your workspace</strong><span>Everything in its place.</span><div className="loading-track"><i /></div></div>}
    </main>
  );

  if (screen === 'login') return (
    <main className="login-screen"><button className="back-link" onClick={() => setScreen('landing')}><ChevronLeft size={16} /> Back to Ediova</button><section className="login-card"><a className="brand login-brand" href="#" onClick={e => { e.preventDefault(); setScreen('landing'); }}><img src="./ediova-mark.svg" alt="" /><span>ediova<span className="brand-dot">.</span></span></a><span className="eyebrow"><LockKeyhole size={13} /> PRIVATE TEAM SPACE</span><h1>Good to have<br />you <em>back.</em></h1><p className="login-intro">Sign in with your authorised Ediova account. Your access level is assigned automatically to your account.</p>
            {isSupabaseConfigured ? <form className="login-form" onSubmit={submitLogin} autoComplete="on"><label>Email address<input type="email" name="ediova-account-entry" autoComplete="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@ediova.com" /></label><label>Password<input type="password" name="ediova-password-entry" autoComplete="current-password" required value={loginPassword} onChange={e => { setLoginPassword(e.target.value); setLoginError(''); }} placeholder="Enter your password" /></label>{loginError && <p className="login-error" role="alert">{loginError}</p>}<button className="button button-dark full" disabled={loading}>{loading ? 'Signing in…' : 'Sign in securely'} <ArrowRight size={16} /></button></form> : <div className="preview-note"><Sparkles size={17} /><span><strong>Interactive preview</strong><small>Supabase is not configured yet. Continue to explore the interface with local sample data.</small></span></div>}
      {!isSupabaseConfigured && <button className="button button-dark full" onClick={() => void submitLogin(new Event('submit') as unknown as FormEvent)} disabled={loading}>Continue to preview <ArrowRight size={16} /></button>}
      <p className="login-legal">Use your authorised Ediova account and sign out when you finish on a shared computer. On a trusted device, your active session can take you straight back to the workspace.</p></section><footer className="login-footer"><span>© {new Date().getFullYear()} Ediova</span><a href="mailto:support@ediova.com">Need help? Contact the team</a><button onClick={() => setView('privacy')}>Privacy &amp; security</button></footer></main>
  );

  const navViews = nav.concat([{ id: 'policies', label: 'Company policies', icon: FileText }, { id: 'privacy', label: 'Privacy & security', icon: ShieldCheck }]);
  const mobilePrimaryNavViews = navViews.filter(item => ['dashboard', 'tasks', 'calendar', 'payments'].includes(item.id));
  const mobileMoreNavViews = navViews.filter(item => ['completed', 'performance', 'profile', 'templates', 'policies', 'privacy'].includes(item.id));
  const viewTitle = ({ dashboard: 'Today', tasks: 'All tasks', calendar: 'Calendar', completed: 'Completed work', performance: 'Manager performance', profile: 'Your profile', templates: 'Templates', payments: 'Payments', policies: 'Company policies', privacy: 'Privacy & security' } as Record<View, string>)[view];
  const filteredTemplates = templates.filter(template => (templateCategoryFilter === 'all' || template.category === templateCategoryFilter) && (template.title + ' ' + template.category + ' ' + templatePlainText(template.body_html)).toLowerCase().includes(templateSearch.trim().toLowerCase()));
  const selectedTemplate = filteredTemplates.find(template => template.id === templateSelectedId) || filteredTemplates[0] || null;
  const filteredComments = activeTask ? comments.filter(c => c.task_id === activeTask.id) : [];
  const managerId = team.find(p => p.role === 'manager')?.id || managerDemo.id;
  function openComposer() { if (!director) return; startCreate(); }
  function startTemplateCreate(source?: WorkspaceTemplate) {
    const canEditSource = Boolean(source && !isBuiltInTemplate(source) && source.created_by === profile?.id);
    const chosen = source || null;
    setTemplateEditing(canEditSource ? chosen : null);
    setTemplateTitleDraft(chosen ? chosen.title + (canEditSource ? '' : ' — Copy') : '');
    setTemplateCategoryDraft(chosen?.category || 'task');
    setTemplateSharedDraft(chosen ? Boolean(chosen.is_shared) : true);
    setTemplateBodyDraft(chosen ? chosen.body_html : '');
    setTemplateEditorOpen(true);
  }
  async function saveTemplate(event: FormEvent) {
    event.preventDefault();
    if (!profile || !templateTitleDraft.trim()) { notify('Add a template title first.'); return; }
    const body = sanitizeTemplateHtml(templateEditorRef.current?.innerHTML || templateBodyDraft).trim();
    if (!templatePlainText(body)) { notify('Add some template content before saving.'); return; }
    const payload = { title: templateTitleDraft.trim(), category: templateCategoryDraft, body_html: body, is_shared: templateSharedDraft, updated_at: new Date().toISOString() };
    let saved: WorkspaceTemplate;
    if (session && supabase) {
      const result = templateEditing && !isBuiltInTemplate(templateEditing)
        ? await supabase.from('workspace_templates').update(payload).eq('id', templateEditing.id).eq('created_by', profile.id).select('*').single()
        : await supabase.from('workspace_templates').insert({ ...payload, created_by: profile.id }).select('*').single();
      if (result.error || !result.data) { notify('Template could not be saved: ' + (result.error?.message || 'please try again')); return; }
      saved = result.data as WorkspaceTemplate;
    } else {
      saved = { ...(templateEditing && !isBuiltInTemplate(templateEditing) ? templateEditing : {}), ...payload, id: templateEditing && !isBuiltInTemplate(templateEditing) ? templateEditing.id : 'local-template-' + Date.now(), created_by: profile.id, created_at: templateEditing?.created_at || new Date().toISOString() };
    }
    setTemplates(prev => templateEditing && !isBuiltInTemplate(templateEditing) ? prev.map(item => item.id === saved.id ? saved : item) : [saved, ...prev]);
    setTemplateSelectedId(saved.id);
    setTemplateEditorOpen(false);
    notify(templateEditing && !isBuiltInTemplate(templateEditing) ? 'Template updated.' : 'Template saved to your library.');
  }
  async function deleteTemplate(template: WorkspaceTemplate) {
    if (isBuiltInTemplate(template) || template.created_by !== profile?.id) return;
    if (!window.confirm('Delete the template "' + template.title + '"? This will not affect tasks or invoices already created from it.')) return;
    if (session && supabase) {
      const { error } = await supabase.from('workspace_templates').delete().eq('id', template.id).eq('created_by', profile?.id);
      if (error) { notify('Template could not be deleted: ' + error.message); return; }
    }
    const next = templates.filter(item => item.id !== template.id);
    setTemplates(next);
    setTemplateSelectedId(next[0]?.id || '');
    setTemplateEditorOpen(false);
    notify('Template deleted.');
  }
  async function copyTemplate(template: WorkspaceTemplate) {
    const html = sanitizeTemplateHtml(template.body_html);
    const plain = templatePlainText(html);
    try {
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined' && 'write' in navigator.clipboard) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(plain);
      } else {
        throw new Error('Clipboard access is unavailable in this browser.');
      }
      notify('Formatted template copied. Paste it into your document, email, or invoice editor.');
    } catch {
      notify('Clipboard access was blocked. Open the template and copy its content manually.');
    }
  }
  function useTemplate(template: WorkspaceTemplate) {
    const plain = templatePlainText(template.body_html);
    if (template.category === 'task') {
      if (!director) { void copyTemplate(template); return; }
      setEditing(null);
      setDraft({ ...defaultTaskDraft(), title: template.title, description: plain, assignee: team.find(p => p.role === 'manager')?.id || managerDemo.id });
      setComposer(true);
      notify('Task template loaded. Review the brief and schedule details.');
      return;
    }
    if (template.category === 'notice' && director) {
      setNoticeTitleDraft(template.title);
      setNoticeBodyDraft(plain);
      setNoticeComposer(true);
      return;
    }
    void copyTemplate(template);
  }
  async function publishDashboardNotice(event: FormEvent) {
    event.preventDefault();
    if (!director || !profile || !noticeTitleDraft.trim() || !noticeBodyDraft.trim()) return;
    if (session && supabase) {
      await supabase.from('company_notices').update({ is_active: false }).eq('is_active', true);
      const { data, error } = await supabase.from('company_notices').insert({
        title: noticeTitleDraft.trim(), body: noticeBodyDraft.trim(), created_by: profile.id, is_active: true,
      }).select('*').single();
      if (error || !data) { notify('Notice could not be published: ' + (error?.message || 'try again')); return; }
      setDashboardNotice(data as CompanyNotice);
    } else {
      setDashboardNotice({ id: 'preview-notice-' + Date.now(), title: noticeTitleDraft.trim(), body: noticeBodyDraft.trim(), created_by: profile.id, created_at: new Date().toISOString(), is_active: true });
    }
    setNoticeTitleDraft(''); setNoticeBodyDraft(''); setNoticeComposer(false); setView('dashboard'); notify('Dashboard notice published.');
  }
  async function dismissDashboardNotice() {
    if (!director || !dashboardNotice) return;
    if (session && supabase && !dashboardNotice.id.startsWith('preview-')) {
      const { error } = await supabase.from('company_notices').update({ is_active: false }).eq('id', dashboardNotice.id);
      if (error) { notify('Could not archive notice: ' + error.message); return; }
    }
    setDashboardNotice(null); notify('Notice archived.');
  }
  function startNewUserNote() {
    setNoteEditing(null); setNoteTitleDraft(''); setNoteBodyDraft(''); setNoteReminderDateDraft(''); setNotepadOpen(true);
  }
  function startEditUserNote(note: UserNote) {
    setNoteEditing(note); setNoteTitleDraft(note.title); setNoteBodyDraft(note.body);
    setNoteReminderDateDraft(note.reminder_date || ''); setNotepadOpen(true);
  }
  async function saveUserNote(event: FormEvent) {
    event.preventDefault();
    if (!profile || !noteTitleDraft.trim()) return;
    const now = new Date().toISOString();
    const reminderDate = noteReminderDateDraft || null;
    const patch: Record<string, unknown> = { title: noteTitleDraft.trim(), body: noteBodyDraft.trim(), reminder_date: reminderDate, updated_at: now };
    if (!noteEditing || noteEditing.reminder_date !== reminderDate) patch.popup_dismissed_on = null;
    let saved: UserNote;
    if (session && supabase) {
      const result = noteEditing
        ? await supabase.from('user_notes').update(patch).eq('id', noteEditing.id).select('*').single()
        : await supabase.from('user_notes').insert({ ...patch, popup_dismissed_on: null, user_id: profile.id }).select('*').single();
      if (result.error || !result.data) { notify('Your note could not be saved: ' + (result.error?.message || 'please try again')); return; }
      saved = result.data as UserNote;
    } else {
      saved = {
        id: noteEditing?.id || 'local-note-' + Date.now(), user_id: profile.id,
        title: noteTitleDraft.trim(), body: noteBodyDraft.trim(), reminder_date: reminderDate,
        completed_at: noteEditing?.completed_at || null,
        popup_dismissed_on: !noteEditing || noteEditing.reminder_date !== reminderDate ? null : noteEditing.popup_dismissed_on,
        created_at: noteEditing?.created_at || now, updated_at: now,
      };
    }
    setUserNotes(previous => noteEditing ? previous.map(note => note.id === noteEditing.id ? saved : note) : [saved, ...previous]);
    setNotepadOpen(false); setNoteEditing(null); setNoteTitleDraft(''); setNoteBodyDraft(''); setNoteReminderDateDraft('');
    notify(noteEditing ? 'Your note has been updated.' : reminderDate ? 'Note saved with a reminder.' : 'Note saved to your private Notepad.');
  }
  async function setUserNoteCompleted(note: UserNote, completed: boolean) {
    const completedAt = completed ? new Date().toISOString() : null;
    let saved: UserNote = { ...note, completed_at: completedAt, updated_at: new Date().toISOString() };
    if (session && supabase) {
      const { data, error } = await supabase.from('user_notes').update({ completed_at: completedAt }).eq('id', note.id).select('*').single();
      if (error || !data) { notify('Reminder status could not be updated: ' + (error?.message || 'please try again')); return; }
      saved = data as UserNote;
    }
    setUserNotes(previous => previous.map(item => item.id === note.id ? saved : item));
    notify(completed ? 'Reminder completed.' : 'Reminder reopened.');
  }
  async function deleteUserNote(note: UserNote) {
    if (session && supabase) {
      const { error } = await supabase.from('user_notes').delete().eq('id', note.id);
      if (error) { notify('Note could not be removed: ' + error.message); return; }
    }
    setUserNotes(previous => previous.filter(item => item.id !== note.id));
    notify('Note removed from your Notepad.');
  }
  async function dismissReminderPopup() {
    const today = currentDateKey;
    const remindersToDismiss = userNotes.filter(note => note.reminder_date === today && !note.completed_at && note.popup_dismissed_on !== today);
    setReminderPopupDismissedForDate(today); setReminderPopupOpen(false);
    if (session && supabase && remindersToDismiss.length) {
      const { error } = await supabase.from('user_notes').update({ popup_dismissed_on: today }).in('id', remindersToDismiss.map(note => note.id));
      if (error) { notify('The reminder popup closed, but its dismissal could not be saved: ' + error.message); return; }
    }
    const ids = new Set(remindersToDismiss.map(note => note.id));
    setUserNotes(previous => previous.map(note => ids.has(note.id) ? { ...note, popup_dismissed_on: today } : note));
  }
  return (
    <main className="workspace-shell">
      <aside className="sidebar"><a className="brand side-brand" href="#" onClick={e => { e.preventDefault(); setScreen('landing'); }}><img src="./ediova-mark.svg" alt="" /><span>ediova<span className="brand-dot">.</span></span></a><div className="workspace-tag"><span className="status-led" />TEAM WORKSPACE</div><div className="side-section-label">WORKSPACE</div>{navViews.filter(item => ['dashboard', 'tasks', 'calendar', 'completed', 'performance', 'profile', 'templates', 'payments'].includes(item.id)).map(item => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'nav-item current' : 'nav-item'} onClick={() => setView(item.id)}><Icon size={17} /><span>{item.label}</span>{item.id === 'tasks' && <small>{activeThisMonth.length}</small>}</button>; })}<div className="side-section-label side-spaced">COMPANY</div>{navViews.filter(item => item.id === 'policies' || item.id === 'privacy').map(item => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'nav-item current' : 'nav-item'} onClick={() => setView(item.id)}><Icon size={17} /><span>{item.label}</span></button>; })}<div className="sidebar-bottom"><div className="sidebar-mini-card"><Sparkles size={16} /><strong>Make room<br />for good work.</strong><span>Clarity creates space.</span></div><button className="nav-item" onClick={() => void logout()}><LogOut size={17} /><span>Sign out</span></button><div className="sidebar-user"><div className="user-avatar">{(profile?.full_name || 'E').slice(0, 1)}</div><div><strong>{profile?.full_name || 'Ediova member'}</strong><small>{roleLabel(role)}</small></div><span className="online-dot" /></div></div></aside>
      <section className="workspace-main"><header className="workspace-topbar"><div><span className="workspace-crumb">EDI OVA <span>/</span> {viewTitle.toUpperCase()}</span><h1>{viewTitle}</h1></div><div className="topbar-right"><div className="today-date"><CalendarDays size={15} /><span>{longDate()}</span></div><button className="team-trigger" onClick={() => setTeamModal(true)}><Users size={15} /> Team <span>{teamDirectory.length}</span></button>{director && <><button className="button button-light notice-trigger" onClick={() => setNoticeComposer(true)}><Bell size={15} /> Post notice</button><button className="button button-dark" onClick={openComposer}><Plus size={17} /> New task</button></>}</div></header>
      {preview && <div className="preview-banner"><Sparkles size={16} /><span><strong>Preview mode</strong> — changes are saved in this browser only. Configure Supabase for shared accounts and cross-device persistence.</span></div>}
      <PaymentCenter profile={profile} active={view === 'payments'} dashboard={view === 'dashboard'} onOpen={() => setView('payments')} notify={notify} />

      {view === 'dashboard' && dashboardNotice && <div className="company-notice"><div className="notice-symbol"><Bell size={16} /></div><div className="notice-copy"><span>COMPANY NOTICE</span><strong>{dashboardNotice.title}</strong><p>{dashboardNotice.body}</p></div>{director && <button className="notice-dismiss" onClick={() => void dismissDashboardNotice()} aria-label="Archive notice">Archive</button>}</div>}
      {view === 'dashboard' && <section className="dashboard-notepad-area" aria-label="Personal Notepad and reminders">
        <div className="dashboard-notepad-toolbar"><span className="eyebrow"><NotebookPen size={13} /> YOUR PRIVATE NOTEPAD</span><button className="button button-light dashboard-notepad-trigger" onClick={startNewUserNote}><Plus size={15} /> New note <span className="notepad-open-count">{openPersonalNotesCount}</span></button></div>
        {dashboardReminders.length > 0 && <div className="dashboard-reminder-stack">{dashboardReminders.slice(0, 3).map(note => <article className="dashboard-reminder-card" key={note.id}>
          <button type="button" className="dashboard-reminder-main" onClick={() => startEditUserNote(note)} title="Open note in Notepad">
            <span className={'dashboard-reminder-date' + (note.reminder_date === currentDateKey ? ' reminder-due-today' : '')}><BellRing size={12} /> {note.reminder_date === currentDateKey ? 'TODAY' : 'REMINDER · ' + dateLabel(note.reminder_date + 'T12:00:00+05:00')}</span>
            <strong>{note.title}</strong><span className="dashboard-reminder-preview">{note.body || 'Personal reminder'}</span>
          </button>
          <div className="dashboard-reminder-actions"><button type="button" aria-label={'Mark ' + note.title + ' complete'} title="Complete reminder" onClick={() => void setUserNoteCompleted(note, true)}><Check size={14} /></button><button type="button" aria-label={'Remove ' + note.title} title="Remove reminder" onClick={() => void deleteUserNote(note)}><Trash2 size={14} /></button></div>
        </article>)}
        {dashboardReminders.length > 3 && <button className="dashboard-more-reminders" onClick={() => setNotepadOpen(true)}>+{dashboardReminders.length - 3} more reminders · Open Notepad</button>}</div>}
      </section>}
      {view === 'dashboard' && <section className="today-board">
        <header className="today-board-header"><div><span className="eyebrow">TODAY'S FOCUS</span><h2>Today's tasks</h2><p>{todayTasks.length ? "Today's scheduled work and unfinished carry-over tasks." : 'No active tasks are scheduled for today or carried over from earlier days.'}</p></div><span className="today-count">{String(todayTasks.length).padStart(2, '0')} tasks</span></header>
        <div className="today-task-grid" style={{ gridTemplateColumns: `repeat(${Math.max(2, Math.ceil(todayTasks.length / 3))}, minmax(0, 1fr))` }}>
          {todayTasks.length ? todayTasks.map((task, index) => <TaskCard key={task.id} colorIndex={index} task={task} selected={activeTaskId === task.id} director={director} onOpen={() => openTask(task)} onStatus={status => void setStatus(task, status)} onEdit={() => startEdit(task)} />) : <div className="today-empty"><div className="empty-icon"><Check size={22} /></div><h3>You're all caught up.</h3><p>Today's tasks and unfinished work from previous days appear here. Future tasks stay in Calendar until their release date.</p></div>}
        </div>
      </section>}
      {view === 'tasks' && <>
        <div className="day-picker-header"><div><span className="eyebrow">CURRENT CALENDAR MONTH</span><h2>Tasks by day</h2><p>Task counts include only work scheduled between the first and last day of this month. Repeating tasks roll into the next month when it begins.</p></div><span className="today-count">{activeThisMonth.length} this month</span></div>
        <div className="day-switcher">
          {[-1, 0, 1, 2].map(offset => <button type="button" key={offset} className={selectedTaskDay === offset ? 'day-switch current' : 'day-switch'} onClick={() => setSelectedTaskDay(offset)}><span>{dayHeading(offset)}</span><small>{offset < 0 ? activeThisMonth.filter(t => dayOffset(t.deadline_at) < 0).length : activeThisMonth.filter(t => dayOffset(t.deadline_at) === offset).length} tasks</small></button>)}
        </div>
        <div className="day-task-list task-list-simple">
          {visible.map((task, index) => <TaskCard key={task.id} colorIndex={index} task={task} selected={activeTaskId === task.id} director={director} onOpen={() => openTask(task)} onStatus={status => void setStatus(task, status)} onEdit={() => startEdit(task)} />)}
          {visible.length === 0 && <div className="empty-state"><div className="empty-icon"><Check size={22} /></div><h3>Nothing due {selectedTaskDay === 0 ? 'today' : selectedTaskDay < 0 ? 'in the past' : selectedTaskDay === 1 ? 'tomorrow' : 'in 2 days'}.</h3><p>Future and other-day tasks are available in Calendar.</p></div>}
        </div>
        <div className="calendar-nudge compact-nudge"><div><CalendarDays size={17} /><div><strong>Explore other dates</strong><span>The calendar holds the complete task schedule.</span></div></div><button className="button button-light" onClick={() => setView('calendar')}>Open calendar <ArrowRight size={15} /></button></div>
      </>}
      {view === 'completed' && <>
        <div className="day-picker-header"><div><span className="eyebrow">PROGRESS, PRESERVED</span><h2>Completed work</h2><p>Your delivered tasks, without the clutter.</p></div></div>
        <div className="day-task-list task-list-simple">
          {visible.map((task, index) => <TaskCard key={task.id} colorIndex={index} task={task} selected={activeTaskId === task.id} director={director} onOpen={() => openTask(task)} onStatus={status => void setStatus(task, status)} onEdit={() => startEdit(task)} />)}
          {visible.length === 0 && <div className="empty-state"><div className="empty-icon"><Check size={22} /></div><h3>Nothing completed yet.</h3><p>Completed work will appear here.</p></div>}
        </div>
      </>}
      {activeTask && <div className="task-popover-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setActiveTaskId(null); }}>
        <aside className="task-inspector task-dialog" role="dialog" aria-modal="true">{activeTask ? <><div className="inspector-top"><span className="eyebrow">TASK DETAILS</span><button className="icon-button" aria-label="Close details" onClick={() => setActiveTaskId(null)}><X size={17} /></button></div><h3 className="task-dialog-title">{activeTask.title}</h3><StatusPill value={effectiveStatus(activeTask)} /><p className="inspector-description">{activeTask.description || 'No description has been added.'}</p>{(activeTask.resource_urls?.length ? activeTask.resource_urls : activeTask.resource_url ? [activeTask.resource_url] : []).map((url, index) => <a className="resource-link" key={url + index} href={url} target="_blank" rel="noreferrer"><LinkIcon size={15} /> {resourceHostLabel(url)} <ExternalLink size={13} /></a>)}<div className="inspector-meta"><span><CalendarDays size={15} /> Release</span><strong>{dateLabel(activeTask.scheduled_at, true)}</strong><span><Clock3 size={15} /> Deadline</span><strong className={effectiveStatus(activeTask) === 'overdue' ? 'danger-text' : ''}>{dateLabel(activeTask.deadline_at, true)}</strong><span><Target size={15} /> Priority</span><strong>{priorityLabel(activeTask.priority)}</strong>{director && directorTaskHours[activeTask.id] != null && <><span><Clock3 size={15} /> Planned time</span><strong>{directorTaskHours[activeTask.id]} credited hours</strong></>}{activeTask.repeat_unit && activeTask.repeat_unit !== 'none' && <><span><Repeat size={15} /> Repeats</span><strong>{activeTask.repeat_unit === 'monthly' ? 'Monthly · day ' + (activeTask.repeat_day_one || keyFor(activeTask.scheduled_at).split('-')[2]) + ((activeTask.repeat_monthly_count || 1) === 2 ? ' & ' + activeTask.repeat_day_two : '') : 'Every ' + (activeTask.repeat_every || 1) + ' ' + (activeTask.repeat_unit === 'daily' ? 'day' : 'week') + ((activeTask.repeat_every || 1) > 1 ? 's' : '')}{activeTask.repeat_until ? ' · until ' + dateLabel(activeTask.repeat_until) : ' · ongoing'}</strong></>}</div>{(director || new Date(activeTask.scheduled_at).getTime() <= Date.now()) && activeTask.status !== 'completed' && activeTask.status !== 'cancelled' && <div className="inspector-actions">{director && activeTask.status !== 'in_progress' && <button className="button button-light" onClick={() => void startTaskNow(activeTask)}><Clock3 size={15} /> Start now</button>}{!director && activeTask.status !== 'in_progress' && <button className="button button-light" onClick={() => void setStatus(activeTask, 'in_progress')}>Start task</button>}<button className="button button-dark" onClick={() => void setStatus(activeTask, 'completed')}><Check size={15} /> Mark complete</button></div>}{director && activeTask.status === 'completed' && <div className="inspector-actions"><button className="button button-light" onClick={() => void setStatus(activeTask, 'in_progress')}><Repeat size={15} /> Reopen task</button></div>}{director && <div className="task-director-actions">{!activeTask.recurrence_parent_id && (!activeTask.repeat_unit || activeTask.repeat_unit === 'none') && activeTask.status !== 'cancelled' && activeTask.status !== 'archived' && <button className="edit-task-link repeat-task-action" onClick={() => startRepeatingTask(activeTask)}><Repeat size={14} /> Make repetitive</button>}<button className="edit-task-link" onClick={() => startEdit(activeTask)}>Edit task <ArrowRight size={14} /></button><button className="delete-task-link" onClick={() => setTaskPendingDelete(activeTask)}><X size={14} /> Delete task</button></div>}{director && activeTask.repeat_unit && activeTask.repeat_unit !== 'none' && !activeTask.recurrence_parent_id && <button className="button button-light schedule-stop-button" onClick={() => void dismantleSchedule(activeTask)}><X size={15} /> Dismantle schedule</button>}<div className="comments-heading"><MessageCircle size={16} /><strong>Team conversation</strong><span>{filteredComments.length}</span></div><div className="comment-list">{filteredComments.map(c => <div className="comment" key={c.id}><div className="comment-avatar">{(c.author_name || 'E').slice(0, 1)}</div><div><strong>{c.author_name || 'Ediova team'}</strong><small>{dateLabel(c.created_at, true)}</small><p>{c.body}</p></div></div>)}{filteredComments.length === 0 && <p className="muted-copy">No comments yet. Leave the first helpful note.</p>}</div><form className="comment-form" onSubmit={addComment}><input value={commentDraft} onChange={e => setCommentDraft(e.target.value)} placeholder="Add a comment…" maxLength={4000} required /><button aria-label="Send comment"><ArrowRight size={16} /></button></form></> : <div className="inspector-empty"><div className="empty-icon"><MessageCircle size={22} /></div><h3>Select a task</h3><p>Open any task to view its brief, dates, resource links and team conversation.</p></div>}</aside>
      </div>}
      {view === 'performance' && <section className="performance-page">
        <div className="performance-heading"><span className="eyebrow">PROGRESS, MADE VISIBLE</span><h2>{director ? 'Manager performance.' : 'Your performance.'}</h2><p>Monthly task completions and credited hours update automatically when completed work is recorded. The Manager sees monthly totals only; task-level hour targets remain private to the Managing Director.</p></div>
        <div className="performance-month-filter"><label>Reporting month<input type="month" value={performanceMonth} onChange={e => selectPerformanceMonth(e.target.value)} /></label><span>{new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(performanceMonth + '-01T12:00:00Z'))}</span></div>
        <div className="monthly-output-grid">
          <article className="monthly-output-card monthly-output-green"><span>COMPLETED IN SELECTED MONTH</span><strong>{monthlyPerformanceRows.filter(row => director || row.manager_id === profile?.id).reduce((total, row) => total + Number(row.completed_tasks || 0), 0)}</strong><small>tasks delivered</small></article>
          <article className="monthly-output-card monthly-output-blue"><span>HOURS CREDITED IN SELECTED MONTH</span><strong>{monthlyPerformanceRows.filter(row => director || row.manager_id === profile?.id).reduce((total, row) => total + Number(row.completed_hours || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong><small>director-assigned hours on completed tasks</small></article>
        </div>
        <section className="performance-calendar-section">
          <div className="performance-calendar-top"><div><span className="eyebrow">DAILY BREAKDOWN</span><h3>Performance calendar</h3><p>Select any date to review completed work and credited hours for that exact day.</p></div><div className="performance-calendar-controls"><button type="button" className="icon-button" onClick={() => shiftPerformanceMonth(-1)} aria-label="Previous performance month"><ChevronLeft size={17} /></button><strong>{performanceCalendarTitle}</strong><button type="button" className="icon-button" onClick={() => { const p = todayKey().split('-').map(Number); setPerformanceCalendarMonth(new Date(p[0], p[1] - 1, 1)); setPerformanceMonth(todayKey().slice(0, 7)); setPerformanceSelectedDate(todayKey()); }} aria-label="Show today's performance">Today</button><button type="button" className="icon-button" onClick={() => shiftPerformanceMonth(1)} aria-label="Next performance month"><ChevronRight size={17} /></button></div></div>
          <div className="performance-calendar-week">{['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(day => <span key={day}>{day}</span>)}</div>
          <div className="performance-calendar-grid">{performanceCalendarCells.map((day, index) => {
            if (!day) return <div className="performance-day-empty" key={'blank-' + index} />;
            const dateKey = performanceCalendarMonth.getFullYear() + '-' + String(performanceCalendarMonth.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            const count = released.filter(task => task.status === 'completed' && Boolean(task.completed_at) && keyFor(task.completed_at as string) === dateKey && (director || task.assignee_id === profile?.id)).length;
            const isToday = dateKey === todayKey();
            return <button type="button" key={dateKey} className={'performance-day' + (performanceSelectedDate === dateKey ? ' selected' : '') + (isToday ? ' is-today' : '') + (count ? ' has-completions' : '')} aria-pressed={performanceSelectedDate === dateKey} onClick={() => setPerformanceSelectedDate(dateKey)}><span>{day}</span>{count > 0 && <small>{count} done</small>}</button>;
          })}</div>
          <div className="selected-day-performance"><div className="selected-day-heading"><div><span>SELECTED DATE</span><h4>{dateLabel(performanceSelectedDate + 'T12:00:00+05:00')}</h4></div><div className="selected-day-metrics"><div><small>Completed tasks</small><strong>{selectedDateCompletedCount}</strong></div><div><small>Credited hours</small><strong>{selectedDateCreditedHours}<em> hrs</em></strong></div></div></div>
            <div className="selected-day-task-list">{selectedDateCompletedTasks.length ? selectedDateCompletedTasks.map(task => <article className="performance-completed-task" key={task.id}><div><strong>{task.title}</strong><span>{director ? (team.find(person => person.id === task.assignee_id)?.full_name || 'Ediova team') + ' · ' : ''}{task.completed_at ? dateLabel(task.completed_at, true) : 'Completed'}</span></div>{director && <strong className="task-credit-label">{directorTaskHours[task.id] == null ? 'No hours assigned' : Number(directorTaskHours[task.id]).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' hrs credited'}</strong>}</article>) : <p className="selected-day-empty">No completed tasks were recorded for this date.</p>}</div></div>
        </section>
        <div className="performance-grid">{performanceRows.filter(row => director || row.manager_id === profile?.id).map(row => {
          const month = monthlyPerformanceRows.find(item => item.manager_id === row.manager_id);
          return <article className="performance-card" key={row.manager_id}>
            <div className="performance-card-top"><div className="performance-avatar">{row.manager_name.slice(0,1)}</div><div><h3>{row.manager_name}</h3><span>{row.location || 'Ediova Manager'}</span></div><strong className={row.performance_score < 70 ? 'score-low' : row.performance_score < 90 ? 'score-mid' : 'score-high'}>{row.performance_score}<small>/100</small></strong></div>
            <div className="score-track"><i style={{width: row.performance_score + '%'}} /></div>
            <div className="performance-stats"><span><strong>{row.assigned_tasks}</strong> Assigned</span><span><strong>{row.completed_tasks}</strong> Completed overall</span><span><strong>{row.delayed_tasks}</strong> Delayed</span></div>
            <div className="monthly-manager-stats"><div><span>Tasks this month</span><strong>{month ? Number(month.completed_tasks) : 0}</strong></div><div><span>Hours credited this month</span><strong>{month ? Number(month.completed_hours).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0'} <small>hrs</small></strong></div></div>
            <p className="performance-note">{row.delayed_tasks ? row.delayed_tasks + ' task(s) are overdue or were completed late.' : 'No late tasks recorded.'} Scores still deduct 10 points per full day late.</p>
          </article>;
        })}{performanceRows.filter(row => director || row.manager_id === profile?.id).length === 0 && <div className="empty-state"><h3>Performance data is loading.</h3><p>Assign tasks and record completions to build the score.</p></div>}</div>
      </section>}
      {view === 'calendar' && <section className="calendar-panel"><div className="calendar-heading"><div><span className="eyebrow">MAKE TIME FOR THE WORK</span><h2>{monthTitle}</h2></div><div className="calendar-paging"><button className="icon-button" onClick={() => monthShift(-1)} aria-label="Previous month"><ChevronLeft /></button><button className="icon-button" onClick={() => setCalendarMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button><button className="icon-button" onClick={() => monthShift(1)} aria-label="Next month"><ChevronRight /></button></div></div><div className="calendar-week">{['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => <span key={d}>{d}</span>)}</div><div className="calendar-grid">{calendarCells.map((day, i) => { const key = day ? calendarMonth.getFullYear() + '-' + String(calendarMonth.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0') : 'blank-' + i; const items = day ? (calendarEventsByDate[key] || []) : []; return <div className={'calendar-day' + (!day ? ' blank' : '') + (day && key === todayKey() ? ' is-today' : '')} key={key}><span className="calendar-day-num">{day || ''}</span>{items.slice(0, 3).map(item => <button key={item.id} className={'calendar-event ' + (item.isVirtual ? 'event-pending event-series-preview' : effectiveStatus(item.task) === 'overdue' ? 'event-late' : 'event-' + item.task.status)} onClick={() => openTask(item.task)} title={item.isVirtual ? item.task.title + ' · repeating schedule' : item.task.title}>{item.task.title}{item.isVirtual ? ' ↻' : ''}</button>)}{items.length > 3 && <small>+{items.length - 3} more</small>}</div>; })}</div></section>}
      {view === 'templates' && <section className="template-library">
        <div className="template-library-heading"><div><span className="eyebrow">READY-MADE WORKFLOWS</span><h2>Templates, ready to use.</h2><p>Search task briefs, team notices, and invoices. Edit your own templates in the notepad or copy formatted content into the document you are working on.</p></div><button className="button button-dark" onClick={() => startTemplateCreate()}><Plus size={16} /> New template</button></div>
        <div className="template-workbench">
          <aside className="template-sidebar">
            <div className="template-search-box"><Search size={16} /><input value={templateSearch} onChange={e => setTemplateSearch(e.target.value)} placeholder="Search templates..." aria-label="Search templates" /></div>
            <div className="template-category-tabs">{([{id:'all',label:'All'},{id:'task',label:'Tasks'},{id:'notice',label:'Notices'},{id:'invoice',label:'Invoices'},{id:'general',label:'General'}] as {id:'all' | TemplateCategory; label:string}[]).map(item => <button key={item.id} className={templateCategoryFilter === item.id ? 'current' : ''} onClick={() => setTemplateCategoryFilter(item.id)}>{item.label}</button>)}</div>
            <div className="template-result-count">{filteredTemplates.length} {filteredTemplates.length === 1 ? 'template' : 'templates'}</div>
            <div className="template-result-list">{filteredTemplates.map(template => <button key={template.id} className={'template-result' + (selectedTemplate?.id === template.id ? ' selected' : '')} onClick={() => { setTemplateSelectedId(template.id); setTemplateEditorOpen(false); }}><span className={'template-type-mark type-' + template.category}>{template.category === 'task' ? <Target size={15} /> : template.category === 'notice' ? <Bell size={15} /> : template.category === 'invoice' ? <FileText size={15} /> : <NotebookPen size={15} />}</span><span className="template-result-text"><strong>{template.title}</strong><small>{template.category[0].toUpperCase() + template.category.slice(1)} · {isBuiltInTemplate(template) ? 'Ediova starter' : template.is_shared ? 'Shared with team' : 'Private template'}</small></span></button>)}
              {filteredTemplates.length === 0 && <div className="template-empty-list"><Search size={20} /><strong>No matching templates</strong><span>Try a different phrase or category.</span></div>}
            </div>
          </aside>
          <section className="template-paper-area">
            {templateEditorOpen ? <form className="template-editor-card" onSubmit={saveTemplate}>
              <div className="template-editor-top"><div><span className="eyebrow">{templateEditing ? 'YOUR TEMPLATE' : 'NEW LIBRARY ITEM'}</span><h3>{templateEditing ? 'Edit template' : 'Create a template'}</h3></div><button type="button" className="icon-button" onClick={() => setTemplateEditorOpen(false)} aria-label="Close editor"><X size={17} /></button></div>
              <div className="template-editor-meta"><label>Template name<input required maxLength={120} value={templateTitleDraft} onChange={e => setTemplateTitleDraft(e.target.value)} placeholder="Name this template" /></label><label>Category<select value={templateCategoryDraft} onChange={e => setTemplateCategoryDraft(e.target.value as TemplateCategory)}><option value="task">Task brief</option><option value="notice">Notice</option><option value="invoice">Invoice</option><option value="general">General</option></select></label></div>
              <div className="template-share-row"><label><input type="checkbox" checked={templateSharedDraft} onChange={e => setTemplateSharedDraft(e.target.checked)} /> Share with the team</label><span>{templateSharedDraft ? <><Share2 size={13} /> Visible to everyone in Ediova</> : 'Only visible to you'}</span></div>
              <div className="template-format-toolbar" aria-label="Text formatting toolbar">
                <button type="button" title="Bold" onMouseDown={e => e.preventDefault()} onClick={() => { templateEditorRef.current?.focus(); document.execCommand('bold'); }}><Bold size={15} /></button>
                <button type="button" title="Italic" onMouseDown={e => e.preventDefault()} onClick={() => { templateEditorRef.current?.focus(); document.execCommand('italic'); }}><Italic size={15} /></button>
                <button type="button" title="Underline" onMouseDown={e => e.preventDefault()} onClick={() => { templateEditorRef.current?.focus(); document.execCommand('underline'); }}><Underline size={15} /></button>
                <span />
                <button type="button" title="Bulleted list" onMouseDown={e => e.preventDefault()} onClick={() => { templateEditorRef.current?.focus(); document.execCommand('insertUnorderedList'); }}><List size={15} /></button>
                <button type="button" title="Numbered list" onMouseDown={e => e.preventDefault()} onClick={() => { templateEditorRef.current?.focus(); document.execCommand('insertOrderedList'); }}><ListOrdered size={15} /></button>
                <span />
                <button type="button" title="Align left" onMouseDown={e => e.preventDefault()} onClick={() => { templateEditorRef.current?.focus(); document.execCommand('justifyLeft'); }}><AlignLeft size={15} /></button>
                <button type="button" title="Align center" onMouseDown={e => e.preventDefault()} onClick={() => { templateEditorRef.current?.focus(); document.execCommand('justifyCenter'); }}><AlignCenter size={15} /></button>
                <label className="template-color-control" title="Text color">A<input type="color" onChange={e => { templateEditorRef.current?.focus(); document.execCommand('foreColor', false, e.target.value); }} aria-label="Text color" /></label>
              </div>
              <div ref={templateEditorRef} className="template-rich-editor" contentEditable suppressContentEditableWarning onInput={e => setTemplateBodyDraft(sanitizeTemplateHtml(e.currentTarget.innerHTML))} data-placeholder="Write your template here. Paste formatted content, tables, headings, and lists..." role="textbox" aria-label="Template content editor" aria-multiline="true" />
              <div className="template-editor-footer"><span>Rich text · headings · lists · tables · colors</span><div><button type="button" className="button button-light" onClick={() => setTemplateEditorOpen(false)}>Cancel</button><button type="submit" className="button button-dark"><Save size={15} /> Save template</button></div></div>
            </form> : selectedTemplate ? <article className="template-document-card">
              <div className="template-document-toolbar"><span className={'template-type-mark type-' + selectedTemplate.category}>{selectedTemplate.category === 'task' ? <Target size={15} /> : selectedTemplate.category === 'notice' ? <Bell size={15} /> : selectedTemplate.category === 'invoice' ? <FileText size={15} /> : <NotebookPen size={15} />}</span><span className="template-document-category">{selectedTemplate.category.toUpperCase()} TEMPLATE</span><div className="template-toolbar-spacer" /><button className="icon-button" title="Copy formatted content" onClick={() => void copyTemplate(selectedTemplate)}><Copy size={15} /></button>{!isBuiltInTemplate(selectedTemplate) && selectedTemplate.created_by === profile?.id && <button className="icon-button" title="Delete template" onClick={() => void deleteTemplate(selectedTemplate)}><Trash2 size={15} /></button>}</div>
              <header className="template-document-title"><span className="eyebrow">{isBuiltInTemplate(selectedTemplate) ? 'EDI OVA STARTER' : selectedTemplate.is_shared ? 'SHARED WORKSPACE TEMPLATE' : 'YOUR PRIVATE TEMPLATE'}</span><h3>{selectedTemplate.title}</h3><p>Formatted working copy · paste-ready</p></header>
              <div className="template-document-content" dangerouslySetInnerHTML={{ __html: sanitizeTemplateHtml(selectedTemplate.body_html) }} />
              <div className="template-document-actions"><button className="button button-light" onClick={() => startTemplateCreate(selectedTemplate)}>{!isBuiltInTemplate(selectedTemplate) && selectedTemplate.created_by === profile?.id ? 'Edit template' : 'Customize a copy'}</button><button className="button button-dark" onClick={() => useTemplate(selectedTemplate)}>{selectedTemplate.category === 'task' && director ? <Plus size={15} /> : selectedTemplate.category === 'notice' && director ? <Bell size={15} /> : <Copy size={15} />}{selectedTemplate.category === 'task' && director ? ' Create task from template' : selectedTemplate.category === 'notice' && director ? ' Prepare notice' : ' Copy / use template'}</button></div>
              <p className="template-access-note">Your edits are saved to the workspace library. Starter templates remain unchanged; customize a copy to build your own version.</p>
            </article> : <div className="template-empty-paper"><NotebookPen size={25} /><h3>Choose a template</h3><p>Select a template on the left or create a new one.</p></div>}
          </section>
        </div>
      </section>}
      {view === 'profile' && <section className="profile-page"><div className="profile-copy"><span className="eyebrow">THE PERSON BEHIND THE WORK</span><h2>Your profile,<br /><em>your place here.</em></h2><p>Clear ownership and thoughtful communication help good work move forward.</p><div className="profile-details"><span>NAME</span><strong>{profile?.full_name || 'Preview member'}</strong><span>ROLE</span><strong>{roleLabel(role)}</strong><span>LOCATION</span><strong>{profile?.location || (role === 'manager' ? 'Islamabad, Pakistan' : 'Ediova')}</strong><span>EXPERIENCE</span><strong>{profile?.experience || (role === 'manager' ? '2+ years' : 'Leadership')}</strong></div></div><button className={'profile-flip' + (flip ? ' flipped' : '')} onClick={() => setFlip(!flip)} aria-label="Flip profile card"><div className="flip-inner"><div className="flip-front"><span className="float-index">EDI OVA / TEAM CARD</span><div className="profile-symbol">{(profile?.full_name || 'E').slice(0, 1)}</div><h3>{profile?.full_name || 'Ediova member'}</h3><p>{roleLabel(role)}</p><div className="flip-hint">CLICK TO FLIP <ArrowRight size={13} /></div></div><div className="flip-back"><ShieldCheck size={33} /><span className="eyebrow">ACCESS VERIFIED</span><h3>{director ? 'DIRECTOR-LEVEL ACCESS' : 'MANAGER-LEVEL ACCESS'}</h3><p>Role permissions are enforced by your signed-in account and database policies.</p><span className="flip-hint">CLICK TO RETURN</span></div></div></button></section>}
      {view === 'policies' && <InfoPage icon={<FileText size={22} />} eyebrow="HOW WE WORK" title="Company policies." body="We work with care, own our commitments and keep communication useful. Each task should have a clear brief, a realistic deadline and one obvious place for updates. Respect agreed schedules, protect client material, use approved links, and flag blockers early rather than silently missing a deadline." list={['Treat client and company information as confidential.','Keep task comments professional, clear and constructive.','Only share deliverables through approved resources and channels.','Raise timeline risks as soon as you see them.']} />}
      {view === 'privacy' && <InfoPage icon={<ShieldCheck size={22} />} eyebrow="PRIVACY & SECURITY" title="Work stays in the right hands." body="This workspace is intended for authorised Ediova team members. In production, authentication and database access are provided by Supabase with row-level security. Preview mode stores sample task data only in the current browser and does not synchronise it to other people." list={['Do not place passwords, payment details or unnecessary personal data in task comments.','Use individual accounts and never share login credentials.','Managers see assigned tasks only after their scheduled release time.','This draft notice must be reviewed against the final hosting, data retention and business practices before launch.']} />}
      <footer className="workspace-footer"><span><strong>Ediova Inc.</strong> · Jl. Kaluirang 14,5, Yogyakarta 55584, Indonesia</span><span>Workspace times use Asia/Karachi (UTC+05:00).</span><a href="tel:+6281377012611">+62 (813) 77012611 <ArrowUpRight size={13} /></a></footer>
      </section>
      {notepadOpen && <div className="modal-backdrop notepad-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setNotepadOpen(false); }}><section className="notepad-modal" role="dialog" aria-modal="true" aria-labelledby="notepad-title">
        <div className="modal-heading"><div><span className="eyebrow"><NotebookPen size={13} /> PRIVATE TO YOU</span><h2 id="notepad-title">Your Notepad.</h2><p className="notepad-subtitle">Notes and reminders only you can see.</p></div><button type="button" className="icon-button" onClick={() => setNotepadOpen(false)} aria-label="Close Notepad"><X /></button></div>
        <form className="notepad-form" onSubmit={saveUserNote}>
          <label>Note title<input required maxLength={120} value={noteTitleDraft} onChange={event => setNoteTitleDraft(event.target.value)} placeholder="What do you want to remember?" /></label>
          <label>Note<textarea rows={3} maxLength={5000} value={noteBodyDraft} onChange={event => setNoteBodyDraft(event.target.value)} placeholder="Add details, ideas, or a personal reminder…" /></label>
          <label className="notepad-reminder-field"><span>Remind me on <small>OPTIONAL</small></span><input type="date" min={currentDateKey} value={noteReminderDateDraft} onChange={event => setNoteReminderDateDraft(event.target.value)} /><span className="field-hint">On this date, a pop-up will appear after you sign in. The reminder also stays on your dashboard until completed or removed.</span></label>
          <div className="modal-actions"><button type="button" className="button button-light" onClick={() => { setNoteEditing(null); setNoteTitleDraft(''); setNoteBodyDraft(''); setNoteReminderDateDraft(''); setNotepadOpen(false); }}>Cancel</button><button className="button button-dark"><Check size={15} /> {noteEditing ? 'Save note' : 'Add note'}</button></div>
        </form>
        <div className="notepad-list-heading"><div><span className="eyebrow">YOUR NOTES</span><strong>Saved privately</strong></div><span>{userNotes.length} total</span></div>
        <div className="notepad-notes-list">{userNotes.slice().sort((a,b) => b.updated_at.localeCompare(a.updated_at)).map(note => <article className={'notepad-note-row' + (note.completed_at ? ' note-is-completed' : '')} key={note.id}>
          <div className="notepad-note-copy"><strong>{note.title}</strong><p>{note.body || 'No extra details.'}</p><div className="notepad-note-meta">{note.reminder_date && <span><CalendarDays size={12} /> {dateLabel(note.reminder_date + 'T12:00:00+05:00')}</span>}{note.completed_at && <span className="note-completed-label"><Check size={12} /> Completed</span>}</div></div>
          <div className="notepad-note-actions"><button type="button" title="Edit note" aria-label={'Edit ' + note.title} onClick={() => startEditUserNote(note)}><NotebookPen size={14} /></button><button type="button" title={note.completed_at ? 'Reopen reminder' : 'Mark complete'} aria-label={(note.completed_at ? 'Reopen ' : 'Complete ') + note.title} onClick={() => void setUserNoteCompleted(note, !note.completed_at)}>{note.completed_at ? <Repeat size={14} /> : <Check size={14} />}</button><button type="button" className="notepad-delete-action" title="Remove note" aria-label={'Remove ' + note.title} onClick={() => void deleteUserNote(note)}><Trash2 size={14} /></button></div>
        </article>)}{userNotes.length === 0 && <div className="notepad-empty"><NotebookPen size={22} /><strong>Your page is clear.</strong><span>Add your first note or set a date to create a reminder.</span></div>}</div>
      </section></div>}
      {reminderPopupOpen && screen === 'workspace' && popupReminderNotes.length > 0 && <div className="reminder-popup-backdrop" role="presentation"><section className="reminder-popup" role="dialog" aria-modal="true" aria-labelledby="reminder-popup-title">
        <div className="reminder-popup-heading"><div className="reminder-popup-icon"><BellRing size={20} /></div><button type="button" className="icon-button" onClick={() => void dismissReminderPopup()} aria-label="Close reminder popup"><X size={17} /></button></div>
        <span className="eyebrow">A NOTE TO YOURSELF</span><h2 id="reminder-popup-title">Your reminders for today.</h2><p className="reminder-popup-intro">Welcome back, {profile?.full_name?.split(/\s+/)[0] || 'there'}. You set these aside for today.</p>
        <div className="reminder-popup-list">{popupReminderNotes.map(note => <article className="reminder-popup-note" key={note.id}><strong>{note.title}</strong>{note.body && <p>{note.body}</p>}<span><CalendarDays size={12} /> Today · {dateLabel(note.reminder_date + 'T12:00:00+05:00')}</span></article>)}</div>
        <div className="reminder-popup-actions"><button className="button button-light" onClick={() => { void dismissReminderPopup(); setNotepadOpen(true); }}>Review in Notepad</button><button className="button button-dark" onClick={() => void dismissReminderPopup()}>Got it for today <Check size={15} /></button></div>
      </section></div>}
      {teamModal && <div className="modal-backdrop team-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setTeamModal(false); }}><section className="team-modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title"><div className="modal-heading"><div><span className="eyebrow">THE PEOPLE BEHIND THE WORK</span><h2 id="team-modal-title">Ediova team.</h2></div><button type="button" className="icon-button" onClick={() => setTeamModal(false)} aria-label="Close team"><X /></button></div><div className="team-directory-grid">{teamDirectory.slice().sort((a,b)=>a.sort_order-b.sort_order).map((member,index)=><article className="team-person-card" key={member.id}><div className={'team-person-avatar team-avatar-'+(index%4)}>{member.full_name.split(/\s+/).map(part=>part[0]).slice(0,2).join('')}</div><div><h3>{member.full_name}</h3><span>{member.job_title}</span><p>{member.location}</p></div><span className="team-person-number">0{index+1}</span></article>)}</div><p className="team-modal-foot">Ediova Inc. · Yogyakarta, Indonesia</p></section></div>}
      {noticeComposer && director && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setNoticeComposer(false); }}><form className="task-modal notice-modal" onSubmit={publishDashboardNotice}><div className="modal-heading"><div><span className="eyebrow">TEAM COMMUNICATION</span><h2>Post a notice.</h2></div><button type="button" className="icon-button" onClick={() => setNoticeComposer(false)} aria-label="Close"><X /></button></div><label>Notice heading<input required maxLength={120} value={noticeTitleDraft} onChange={e => setNoticeTitleDraft(e.target.value)} placeholder="A quick update for everyone" /></label><label>Message<textarea required rows={4} maxLength={2000} value={noticeBodyDraft} onChange={e => setNoticeBodyDraft(e.target.value)} placeholder="Write the announcement that should appear at the top of every dashboard." /></label><div className="modal-actions"><button type="button" className="button button-light" onClick={() => setNoticeComposer(false)}>Cancel</button><button className="button button-dark"><Bell size={15} /> Publish notice</button></div></form></div>}
      {composer && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setComposer(false); }}><form className="task-modal" onSubmit={saveTask}><div className="modal-heading"><div><span className="eyebrow">{editing ? 'UPDATE THE BRIEF' : 'MAKE IT HAPPEN'}</span><h2>{editing ? 'Edit task.' : 'Create a task.'}</h2></div><button type="button" className="icon-button" onClick={() => setComposer(false)} aria-label="Close"><X /></button></div><label>Task title<input required maxLength={180} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Give the work a clear name" /></label><label>Description<textarea required rows={4} maxLength={10000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What needs to happen? Add the useful details." /></label><div className="form-two"><label>Release date &amp; time<div className="datetime-now-row"><input type="datetime-local" required value={draft.scheduled} onChange={e => setDraft({ ...draft, scheduled: e.target.value, startNow: false })} /><button type="button" className={'button button-light start-now-button' + (draft.startNow ? ' active' : '')} onClick={() => setDraft({ ...draft, scheduled: inputInKarachi(new Date().toISOString()), startNow: true })}><Clock3 size={14} /> {draft.startNow ? 'Starts now' : 'Start now'}</button></div></label><label>Deadline<input type="datetime-local" required value={draft.deadline} onChange={e => setDraft({ ...draft, deadline: e.target.value })} /></label></div><div className="form-two"><label>Priority<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as Priority })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label>Assign to<select value={draft.assignee || managerId} onChange={e => setDraft({ ...draft, assignee: e.target.value })}>{(team.filter(p => p.role === 'manager').length ? team.filter(p => p.role === 'manager') : [managerDemo]).map(p => <option value={p.id} key={p.id}>{p.full_name}</option>)}</select></label></div>{director && <label>Hours credited when completed <span className="optional-label">PRIVATE TO MANAGING DIRECTOR</span><input type="number" min="0.25" max="1000" step="0.25" value={draft.targetHours} onChange={e => setDraft({ ...draft, targetHours: e.target.value })} placeholder="For example, 3.5" /><span className="field-hint">Manually assigned by the Managing Director; credited to performance when the task is completed. The amount stays private from Managers.</span></label>}<label>Task resource links <span className="optional-label">OPTIONAL · ONE URL PER LINE</span><textarea rows={2} value={draft.resource} onChange={e => setDraft({ ...draft, resource: e.target.value })} placeholder="One URL per line" /></label>
          {editing?.recurrence_parent_id ? <p className="recurrence-note">This occurrence belongs to a repeating series. Edit the original task to change its schedule.</p> : <div className="repeat-controls">
            <label>Repeat<select value={draft.repeatUnit} onChange={e => setDraft({ ...draft, repeatUnit: e.target.value as RepeatUnit })}><option value="none">Never</option><option value="daily">Every day</option><option value="weekly">Weekly on selected days</option><option value="monthly">Each month</option></select></label>
            {draft.repeatUnit === 'monthly' ? <>
              <label>Occurrences each month<select value={String(draft.repeatMonthlyCount)} onChange={e => setDraft({ ...draft, repeatMonthlyCount: Number(e.target.value) as RepeatMonthlyCount })}><option value="1">Once a month</option><option value="2">Twice a month</option></select></label>
              <label>Day of month<select value={String(draft.repeatDayOne)} onChange={e => setDraft({ ...draft, repeatDayOne: Number(e.target.value) })}>{Array.from({length:31},(_,i)=>i+1).map(day => <option value={day} key={day}>{day}</option>)}</select></label>
              {draft.repeatMonthlyCount === 2 && <label>Second day<select value={String(draft.repeatDayTwo)} onChange={e => setDraft({ ...draft, repeatDayTwo: Number(e.target.value) })}>{Array.from({length:31},(_,i)=>i+1).filter(day => day !== draft.repeatDayOne).map(day => <option value={day} key={day}>{day}</option>)}</select></label>}
            </> : draft.repeatUnit === 'weekly' ? <>
              <label>Repeat interval<select value={String(draft.repeatEvery)} onChange={e => setDraft({ ...draft, repeatEvery: Number(e.target.value) })}><option value="1">Every week</option><option value="2">Every 2 weeks</option></select></label>
              <div className="repeat-weekdays"><span className="optional-label">SHOW THIS TASK ON</span><div className="weekday-options">{[{day:1,label:'Mon'},{day:2,label:'Tue'},{day:3,label:'Wed'},{day:4,label:'Thu'},{day:5,label:'Fri'},{day:6,label:'Sat'},{day:7,label:'Sun'}].map(item => <label className="weekday-option" key={item.day}><input type="checkbox" checked={draft.repeatDays.includes(item.day)} onChange={e => setDraft({ ...draft, repeatDays: e.target.checked ? [...draft.repeatDays, item.day].sort((a,b) => a-b) : draft.repeatDays.filter(day => day !== item.day) })} /><span>{item.label}</span></label>)}</div></div>
            </> : draft.repeatUnit === 'daily' && <label>Repeat every <span className="optional-label">INTERVAL · DAYS</span><input type="number" min={1} max={365} step={1} required value={draft.repeatEvery} onChange={e => setDraft({ ...draft, repeatEvery: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} /></label>}
            {draft.repeatUnit !== 'none' && <label className="repeat-until-field">End date <span className="optional-label">OPTIONAL · LEAVE BLANK FOR NO END DATE</span><input type="date" value={draft.repeatUntil.slice(0,10)} onChange={e => setDraft({ ...draft, repeatUntil: e.target.value ? e.target.value + 'T23:59' : '' })} min={draft.scheduled.slice(0,10)} /></label>}
            {draft.repeatUnit !== 'none' && <p className="recurrence-note">{draft.repeatUnit === 'weekly' ? 'Select one or more weekdays. The first task is aligned to the next selected day; repeats default to 12:00 AM Pakistan time.' : 'Repeat occurrences preserve the task time and deadline window.'} {draft.repeatUntil ? 'This series ends on the selected date.' : 'No end date is set, so this series repeats indefinitely.'} Future dates appear in Calendar as you navigate ahead; each occurrence becomes a regular task as its month arrives.</p>}
          </div>}
          <div className="modal-actions"><button type="button" className="button button-light" onClick={() => setComposer(false)}>Cancel</button><button className="button button-dark"><Check size={16} /> {editing ? 'Save changes' : 'Schedule task'}</button></div><p className="form-time-note">All times are interpreted as Pakistan Standard Time (UTC+05:00). Tasks automatically start at their scheduled release time; use Start now only to release a task early.</p></form></div>}
      {taskPendingDelete && <div className="confirm-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setTaskPendingDelete(null); }}><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title"><span className="eyebrow">MANAGING DIRECTOR ACTION</span><h2 id="delete-task-title">Delete this task?</h2><p><strong>{taskPendingDelete.title}</strong> will be permanently removed, including its comments, task history, recurrence instances and private hour assignment. This cannot be undone.</p><div className="confirm-actions"><button type="button" className="button button-light" onClick={() => setTaskPendingDelete(null)}>Keep task</button><button type="button" className="button button-danger" onClick={() => void deleteTask(taskPendingDelete)}>Delete permanently</button></div></section></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
      <nav className="mobile-workspace-nav" aria-label="Workspace navigation">
        {mobilePrimaryNavViews.map(item => {
          const Icon = item.icon;
          const selected = view === item.id;
          const label = item.id === 'dashboard' ? 'Today' : item.id === 'tasks' ? 'Tasks' : item.label;
          return <button type="button" key={item.id} className={selected ? 'mobile-nav-item current' : 'mobile-nav-item'} aria-current={selected ? 'page' : undefined} onClick={() => { setView(item.id); setMobileMoreOpen(false); }}>
            <Icon size={19} strokeWidth={selected ? 2.4 : 1.9} /><span>{label}</span>
          </button>;
        })}
        <button type="button" className={mobileMoreOpen ? 'mobile-nav-item current' : 'mobile-nav-item'} aria-expanded={mobileMoreOpen} aria-controls="mobile-more-menu" onClick={() => setMobileMoreOpen(value => !value)}>
          <MoreHorizontal size={20} /><span>More</span>
        </button>
      </nav>
      {mobileMoreOpen && <div className="mobile-more-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setMobileMoreOpen(false); }}>
        <section className="mobile-more-menu" id="mobile-more-menu" role="dialog" aria-modal="true" aria-label="More workspace options">
          <div className="mobile-more-heading"><div><span className="eyebrow">WORKSPACE MENU</span><strong>{profile?.full_name || 'Ediova member'}</strong></div><button type="button" className="icon-button" aria-label="Close menu" onClick={() => setMobileMoreOpen(false)}><X size={17} /></button></div>
          <div className="mobile-more-grid">
            {mobileMoreNavViews.map(item => {
              const Icon = item.icon;
              const selected = view === item.id;
              return <button type="button" key={item.id} className={selected ? 'mobile-more-item current' : 'mobile-more-item'} onClick={() => { setView(item.id); setMobileMoreOpen(false); }}>
                <Icon size={18} /><span>{item.label}</span>{selected && <Check size={14} />}
              </button>;
            })}
            <button type="button" className="mobile-more-item mobile-more-signout" onClick={() => { setMobileMoreOpen(false); void logout(); }}><LogOut size={18} /><span>Sign out</span></button>
          </div>
        </section>
      </div>}
    </main>
  );
}

function TaskCard({ task, selected, director, colorIndex, onOpen, onStatus, onEdit }: { task: Task; selected: boolean; director: boolean; colorIndex: number; onOpen: () => void; onStatus: (s: Status) => void; onEdit: () => void }) {
  return <article className={'task-card compact-task task-tone-' + (colorIndex % 8) + (effectiveStatus(task) === 'overdue' ? ' task-overdue' : '') + (selected ? ' chosen' : '')}>
    <button className="task-open" onClick={onOpen} aria-label={'Open task: ' + task.title}>
      <div className="compact-task-main"><span className="task-card-number">{String(colorIndex + 1).padStart(2, '0')}</span><div className="task-card-copy"><h3>{task.title}</h3><div className="task-card-tags"><StatusPill value={effectiveStatus(task)} /><span className={'priority-chip priority-' + task.priority}>{priorityLabel(task.priority)}</span></div></div></div>
      <div className="compact-task-due"><span className="task-due-caption">DUE</span><strong>{dateLabel(task.deadline_at, true)}</strong><ArrowRight size={16} /></div>
    </button>
  </article>;
}
function StatusPill({ value }: { value: string }) {
  const label = ({ pending: 'To do', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', archived: 'Archived', overdue: 'Overdue' } as Record<string, string>)[value] || value;
  return <span className={'status-pill s-' + value}>{label}</span>;
}
function InfoPage({ icon, eyebrow, title, body, list }: { icon: React.ReactNode; eyebrow: string; title: string; body: string; list: string[] }) {
  return <section className="info-page"><div className="info-icon">{icon}</div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{body}</p><div className="info-list">{list.map((item, i) => <div key={item}><span>0{i + 1}</span><p>{item}</p></div>)}</div><p className="info-disclaimer">Draft copy — review and adapt before using this workspace for real company operations.</p></section>;
}
