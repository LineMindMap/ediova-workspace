import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, BadgeCheck, Banknote, BellRing, CalendarDays, Check, ChevronRight, CircleDollarSign, Clock3, FileText, LockKeyhole, Printer, RefreshCw, ShieldCheck, Trash2, Wallet, X } from 'lucide-react';
import { supabase } from './lib/supabase';

type Role = 'manager' | 'managing_director';
type PaymentProfile = { id: string; full_name: string; role: Role };
type PaymentSettings = { hourly_rate_usd: number | string; late_deduction_usd: number | string };
type WorkItem = { task_id: string; title: string; completed_at: string | null; schedule_at?: string; hours: number | string };
type DelayItem = { task_id: string; title: string; deadline_at: string; completed_at: string | null; delay_hours: number | string };
type UnfinishedItem = { task_id: string; title: string; status: string; schedule_at: string; deadline_at: string };
type PaymentPreview = {
  manager_id: string; manager_name: string; month_start: string; month_end: string;
  completed_tasks: number; completed_hours: number | string; delayed_tasks: number; performance_score: number;
  hourly_rate_usd: number | string; late_deduction_usd: number | string;
  gross_amount_usd: number | string; deductions_usd: number | string; net_amount_usd: number | string;
  work_breakdown: WorkItem[]; delay_breakdown: DelayItem[];
  unfinished_tasks: number; unfinished_deduction_usd: number | string; unfinished_breakdown: UnfinishedItem[];
};
type PaymentRequest = {
  id: string; manager_id: string; manager_name_snapshot: string; month_start: string; invoice_number: string;
  status: 'requested' | 'revision_requested' | 'disputed' | 'approved' | 'paid';
  completed_tasks: number; completed_hours: number | string; delayed_tasks: number; performance_score: number;
  hourly_rate_usd: number | string; late_deduction_usd: number | string;
  gross_amount_usd: number | string; deductions_usd: number | string; net_amount_usd: number | string;
  vat_amount_usd?: number | string; paid_amount?: number | string | null; paid_currency?: 'USD' | 'PKR' | null;
  director_payment_amount_pkr?: number | string | null; director_payment_reason?: string | null;
  director_payment_set_at?: string | null; director_payment_set_by?: string | null;
  bank_name: string; bank_account_holder: string; bank_account_number: string;
  work_breakdown: WorkItem[]; delay_breakdown: DelayItem[];
  unfinished_tasks_count?: number; unfinished_deduction_usd?: number | string; unfinished_breakdown?: UnfinishedItem[];
  revision_note: string | null; dispute_note: string | null; requested_at: string;
  reviewed_at: string | null; paid_at: string | null; updated_at?: string | null;
};
type BankForm = { bank_name: string; account_holder_name: string; account_number: string };
type PaymentEvent = { id: string; request_id: string; actor_name: string; actor_role: Role; action: string; note: string | null; created_at: string };
type ReopenableMonth = { manager_id: string; manager_name: string; month_start: string; claimed_at: string; reopen_allowed: boolean; reopen_count: number; last_reopened_at: string | null };
type ManagerReopenedMonth = { month_start: string; reopen_count: number; last_reopened_at: string | null };
type Props = { profile: PaymentProfile | null; active: boolean; dashboard: boolean; onOpen: () => void; notify: (message: string) => void };

const EMPTY_BANK: BankForm = { bank_name: '', account_holder_name: '', account_number: '' };
const CODE39: Record<string, string> = {
  '0':'111221211','1':'211112112','2':'112112112','3':'212112111','4':'111122112','5':'211122111','6':'112122111','7':'111112212','8':'211112211','9':'112112211',
  A:'211211112',B:'112211112',C:'212211111',D:'111221112',E:'211221111',F:'112221111',G:'111211212',H:'211211211',I:'112211211',J:'111221211',
  K:'211111122',L:'112111122',M:'212111121',N:'111121122',O:'211121121',P:'112121121',Q:'111111222',R:'211111221',S:'112111221',T:'111121221',
  U:'221111112',V:'122111112',W:'222111111',X:'121121112',Y:'221121111',Z:'122121111','-':'121111212',' ':'122111211','$':'121212111','/':'121211121','+':'121112121','%':'111212121','.':'221111211'
};

function previousMonthStart() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === 'year')?.value || '2026');
  const month = Number(parts.find(part => part.type === 'month')?.value || '1');
  const date = new Date(Date.UTC(year, month - 2, 1));
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-01';
}
function formatMonth(value: string) {
  return new Date(value.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function formatDay(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
}
function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
}
function amount(value: number | string | null | undefined) {
  return '$' + Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function quantity(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function payoutAmount(value: number | string | null | undefined, currency: 'USD' | 'PKR' | null | undefined) {
  const formatted = Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'PKR' ? 'PKR ' + formatted : '$' + formatted;
}
function statusLabel(status: PaymentRequest['status']) {
  return ({ requested: 'Sent to Director · awaiting review', revision_requested: 'Revision requested', disputed: 'Under dispute', approved: 'Approved · awaiting transfer', paid: 'Paid' } as Record<string, string>)[status] || status;
}
function BarcodeMark({ value }: { value: string }) {
  const chars = ('*' + value.toUpperCase() + '*').split('');
  let cursor = 8;
  const bars: { x: number; width: number }[] = [];
  chars.forEach((char, charIndex) => {
    const pattern = CODE39[char] || CODE39['-'];
    pattern.split('').forEach((unit, index) => {
      const width = unit === '2' ? 5 : 2.5;
      if (index % 2 === 0) bars.push({ x: cursor, width });
      cursor += width;
    });
    cursor += 2.5;
    if (charIndex === chars.length - 1) cursor += 5;
  });
  return <svg className="payment-barcode-svg" viewBox={'0 0 ' + (cursor + 8) + ' 54'} role="img" aria-label={'Barcode for ' + value} preserveAspectRatio="none">
    {bars.map((bar, index) => <rect key={index} x={bar.x} y="2" width={bar.width} height="42" rx=".25" fill="#163c27" />)}
  </svg>;
}
function EventLabel({ event }: { event: PaymentEvent }) {
  const labels: Record<string, string> = { requested: 'Payment request submitted', resubmitted: 'Revised request submitted', disputed: 'Payment disputed', approved: 'Payment request approved', payout_set: 'Director final payout updated', revision_requested: 'Revision requested', paid: 'Payment marked as paid' };
  return <div className="payment-timeline-item" key={event.id}>
    <span className={'payment-timeline-dot payment-dot-' + event.action} />
    <div><strong>{labels[event.action] || event.action}</strong><small>{event.actor_name} · {event.actor_role === 'managing_director' ? 'Managing Director' : 'Manager'} · {formatDateTime(event.created_at)}</small>{event.note && <p>{event.note}</p>}</div>
  </div>;
}
function InvoiceDocument({ request, preview, managerName, issuedAt }: { request?: PaymentRequest | null; preview?: PaymentPreview | null; managerName: string; issuedAt?: string }) {
  const data = request || preview;
  if (!data) return null;
  const invoiceNumber = request?.invoice_number || 'Generated when payment is requested';
  const work = (request?.work_breakdown || preview?.work_breakdown || []) as WorkItem[];
  const delays = (request?.delay_breakdown || preview?.delay_breakdown || []) as DelayItem[];
  const unfinished = (request?.unfinished_breakdown || preview?.unfinished_breakdown || []) as UnfinishedItem[];
  const unfinishedDeduction = Number(request?.unfinished_deduction_usd ?? preview?.unfinished_deduction_usd ?? 0);
  const lateDeductionTotal = Number(data.delayed_tasks || 0) * Number(data.late_deduction_usd || 0);
  const bankName = request?.bank_name || '';
  const bankHolder = request?.bank_account_holder || '';
  const bankNumber = request?.bank_account_number || '';
  const directorPayoutAmount = request?.director_payment_amount_pkr;
  const invoiceCurrency = directorPayoutAmount != null || request?.paid_currency === 'PKR' ? 'PKR · Pakistani Rupee' : 'USD · US Dollar';
  const start = data.month_start;
  const periodText = formatMonth(start) + ' · ' + formatDay(start) + ' – ' + (request ? formatDay(new Date(Date.UTC(Number(start.slice(0,4)), Number(start.slice(5,7)), 0)).toISOString()) : formatDay(preview?.month_end));
  return <article className="payment-invoice" id="ediova-payment-invoice">
    <div className="payment-invoice-top">
      <div className="payment-invoice-brand"><img src="./ediova-mark.svg" alt="Ediova" /><div><strong>ediova<span>.</span></strong><small>CREATIVE WORKSPACE</small></div></div>
      <div className="payment-invoice-label"><span>WORK INVOICE</span><strong>{request ? statusLabel(request.status) : 'PAYMENT ESTIMATE'}</strong></div>
    </div>
    <div className="payment-invoice-heading"><div><span className="payment-eyebrow">MONTHLY SERVICE STATEMENT</span><h2>Invoice.</h2><p>Professional services · Monthly work summary</p></div>
      <div className="payment-invoice-number"><small>INVOICE NUMBER</small><strong>{invoiceNumber}</strong><small>ISSUED {formatDay(request?.requested_at || issuedAt || new Date().toISOString())}</small></div>
    </div>
    {request && <div className="payment-barcode-block"><BarcodeMark value={request.invoice_number} /><strong>{request.invoice_number}</strong></div>}
    <div className="payment-invoice-parties">
      <div><span className="payment-eyebrow">ISSUED BY</span><strong>Ediova Inc.</strong><p>Jl. Kaliurang 14.5<br />Yogyakarta 55584, Indonesia</p></div>
      <div><span className="payment-eyebrow">PAYABLE TO</span><strong>{request?.manager_name_snapshot || managerName}</strong><p>Manager · Ediova<br />Bank: {bankName || 'Add bank details when requesting'}<br />Account holder: {bankHolder || '—'}<br />Account number: {bankNumber || '—'}</p></div>
    </div>
    <div className="payment-invoice-period"><div><small>WORKING PERIOD</small><strong>{periodText}</strong></div><div><small>PAYMENT CURRENCY</small><strong>{invoiceCurrency}</strong></div><div><small>PAYMENT STATUS</small><strong>{request ? statusLabel(request.status) : 'Not yet submitted'}</strong></div></div>
    <div className="payment-invoice-table-wrap"><table className="payment-invoice-table">
      <thead><tr><th>DESCRIPTION</th><th>QUANTITY</th><th>RATE</th><th className="payment-right">AMOUNT</th></tr></thead>
      <tbody>
        <tr><td><strong>Completed and credited work</strong><small>{quantity(data.completed_tasks)} completed task(s)</small></td><td>{quantity(data.completed_hours)} hrs</td><td>{amount(data.hourly_rate_usd)} / hr</td><td className="payment-right">{amount(data.gross_amount_usd)}</td></tr>
        <tr className="payment-deduction-row"><td><strong>Late-task deductions</strong><small>{quantity(data.delayed_tasks)} task(s) delayed by more than 24 hours</small></td><td>{quantity(data.delayed_tasks)} task(s)</td><td>{amount(data.late_deduction_usd)} / task</td><td className="payment-right">−{amount(lateDeductionTotal)}</td></tr>
        {unfinished.length > 0 && <tr className="payment-deduction-row"><td><strong>Unfinished-task opt-outs</strong><small>Tasks explicitly excluded from this payment request</small></td><td>{quantity(unfinished.length)} task(s)</td><td>$1.00 / task</td><td className="payment-right">−{amount(unfinishedDeduction)}</td></tr>}
        <tr><td><strong>VAT</strong><small>Fixed at 0.00%</small></td><td>—</td><td>0.00%</td><td className="payment-right">{amount(request?.vat_amount_usd ?? 0)}</td></tr>
      </tbody>
    </table></div>
    <div className="payment-invoice-summary">
      <div className="payment-performance-stamp"><ShieldCheck size={17} /><span><small>PERFORMANCE SCORE</small><strong>{quantity(data.performance_score)}<em>/100</em></strong></span></div>
      <div className="payment-invoice-total">
        {directorPayoutAmount != null && <div className="payment-director-final-total">
          <span>DIRECTOR-APPROVED FINAL PAYMENT · PKR</span>
          <strong>{payoutAmount(directorPayoutAmount, 'PKR')}</strong>
          <small>Primary payout amount set by the Managing Director</small>
          {request?.director_payment_reason && <p><b>Director's reason:</b> {request.director_payment_reason}</p>}
        </div>}
        <div><span>Gross amount · USD</span><strong>{amount(data.gross_amount_usd)}</strong></div>
        <div><span>Late-task deductions · USD</span><strong>−{amount(lateDeductionTotal)}</strong></div>
        {unfinished.length > 0 && <div><span>Unfinished-task opt-outs · USD</span><strong>−{amount(unfinishedDeduction)}</strong></div>}
        <div><span>VAT · 0.00% · USD</span><strong>{amount(request?.vat_amount_usd ?? 0)}</strong></div>
        <div className={directorPayoutAmount != null ? 'payment-net-total payment-system-reference-total' : 'payment-net-total'}>
          <span>{directorPayoutAmount != null ? 'SYSTEM-SUGGESTED PAYMENT · USD' : 'SYSTEM-SUGGESTED PAYMENT'}</span>
          <strong>{amount(data.net_amount_usd)}</strong>
        </div>
        {request?.paid_amount != null && request.paid_currency && <div className="payment-actual-paid-total"><span>ACTUAL TRANSFER RECORDED</span><strong>{payoutAmount(request.paid_amount, request.paid_currency)}</strong></div>}
      </div>
    </div>
    <section className="payment-invoice-breakdown">
      <div className="payment-invoice-section-title"><div><span className="payment-eyebrow">01 · DELIVERY RECORD</span><h3>Completed work.</h3></div><span>{work.length} entries</span></div>
      {work.length ? <div className="payment-work-list">{work.map((item, index) => <div className="payment-work-row" key={item.task_id || index}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>Completed {formatDateTime(item.completed_at)}</small></div><b>{quantity(item.hours)} hrs</b></div>)}</div> : <p className="payment-muted">No completed tasks were recorded for this month.</p>}
      {unfinished.length > 0 && <><div className="payment-invoice-section-title payment-delayed-title"><div><span className="payment-eyebrow">02 · PAYMENT OPT-OUTS</span><h3>Unfinished tasks excluded.</h3></div><span>{unfinished.length} entries</span></div><div className="payment-work-list">{unfinished.map((item, index) => <div className="payment-work-row payment-delay-row" key={item.task_id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>{item.status === 'in_progress' ? 'In progress' : 'Not started'} · Due {formatDateTime(item.deadline_at)}</small></div><b>−$1.00</b></div>)}</div></>}
      <div className="payment-invoice-section-title payment-delayed-title"><div><span className="payment-eyebrow">03 · TIMELINE REVIEW</span><h3>Delayed tasks.</h3></div><span>{delays.length} entries</span></div>
      {delays.length ? <div className="payment-work-list">{delays.map((item, index) => <div className="payment-work-row payment-delay-row" key={item.task_id || index}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>Deadline {formatDateTime(item.deadline_at)} · {quantity(item.delay_hours)} hours late</small></div><b>−{amount(data.late_deduction_usd)}</b></div>)}</div> : <p className="payment-muted">No task exceeded the 24-hour delay threshold.</p>}
    </section>
    <div className="payment-invoice-footer"><div><strong>Thank you for your work.</strong><p>This statement assigns completed work to the month the task was scheduled. Tasks opted out of payment are listed separately and deducted at $1.00 each. The Managing Director’s approved PKR payout is shown as primary when set.</p></div><div className="payment-invoice-seal"><BadgeCheck size={24} /><span>EDI OVA<br />ACCOUNTS</span></div></div>
    <div className="payment-invoice-footnote"><span>EDI OVA INC. · INTERNAL PAYMENT DOCUMENT</span><span>{request?.invoice_number || 'PREVIEW'} · {formatMonth(start)}</span></div>
  </article>;
}

export default function PaymentCenter({ profile, active, dashboard, onOpen, notify }: Props) {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [monthAlreadySubmitted, setMonthAlreadySubmitted] = useState(false);
  const [monthReopenAvailable, setMonthReopenAvailable] = useState(false);
  const [reopenableMonths, setReopenableMonths] = useState<ReopenableMonth[]>([]);
  const [managerReopenedMonths, setManagerReopenedMonths] = useState<ManagerReopenedMonth[]>([]);
  const [settings, setSettings] = useState<PaymentSettings>({ hourly_rate_usd: 1, late_deduction_usd: 1 });
  const [rateDraft, setRateDraft] = useState('1');
  const [deductionDraft, setDeductionDraft] = useState('1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [bank, setBank] = useState<BankForm>(EMPTY_BANK);
  const [bankDirty, setBankDirty] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [historicalInvoiceId, setHistoricalInvoiceId] = useState('');
  const [monthStart, setMonthStart] = useState(previousMonthStart);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modal, setModal] = useState<'request' | 'dispute' | 'revision' | 'payment' | 'approve' | null>(null);
  const [optedOutTaskIds, setOptedOutTaskIds] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [paidAmountDraft, setPaidAmountDraft] = useState('');
  const [paidCurrencyDraft, setPaidCurrencyDraft] = useState<'USD' | 'PKR'>('PKR');
  const [directorAmountPreset, setDirectorAmountPreset] = useState<'10000' | '12000' | '15000' | 'custom'>('10000');
  const [directorAmountDraft, setDirectorAmountDraft] = useState('10000');
  const [directorReasonDraft, setDirectorReasonDraft] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  const director = profile?.role === 'managing_director';
  const selectedRequest = requests.find(request => request.id === selectedId) || requests[0] || null;
  const selectedEvents = useMemo(() => selectedRequest ? events.filter(event => event.request_id === selectedRequest.id) : [], [events, selectedRequest?.id]);
  const pendingDirector = requests.filter(request => ['requested', 'disputed', 'approved'].includes(request.status));
  const managerRequest = requests.find(request => request.manager_id === profile?.id && request.month_start === monthStart) || null;
  const historicalInvoice = requests.find(request => request.id === historicalInvoiceId && request.manager_id === profile?.id) || null;
  const unfinishedTasks = preview?.unfinished_breakdown || [];
  const allUnfinishedTasksOptedOut = unfinishedTasks.every(task => optedOutTaskIds.includes(task.task_id)) && optedOutTaskIds.length === unfinishedTasks.length;
  const unfinishedOptOutTotal = Number(preview?.unfinished_deduction_usd || 0);
  const paymentAlertStorageKey = profile ? 'ediova-payment-alert-seen-v1:' + profile.id : '';
  const directorAlertSignature = director && pendingDirector.length
    ? 'director:' + pendingDirector.map(request => [
        request.id, request.status, request.updated_at || request.reviewed_at || request.requested_at
      ].join(':')).sort().join('|')
    : '';
  const managerAlertSignature = !director && (managerRequest || monthAlreadySubmitted || monthReopenAvailable)
    ? 'manager:' + [
        managerRequest?.id || monthStart,
        managerRequest?.status || '',
        managerRequest?.updated_at || managerRequest?.paid_at || managerRequest?.requested_at || '',
        monthAlreadySubmitted ? 'claimed' : '',
        monthReopenAvailable ? 'reopened' : ''
      ].join(':')
    : '';
  const paymentAlertSignature = director ? directorAlertSignature : managerAlertSignature;
  const [seenPaymentAlertSignature, setSeenPaymentAlertSignature] = useState(() => {
    try {
      return profile?.id && typeof window !== 'undefined'
        ? window.localStorage.getItem('ediova-payment-alert-seen-v1:' + profile.id) || ''
        : '';
    } catch { return ''; }
  });
  const paymentAlertVisible = dashboard && Boolean(paymentAlertSignature) && paymentAlertSignature !== seenPaymentAlertSignature;

  function markPaymentAlertSeen() {
    if (!paymentAlertStorageKey || !paymentAlertSignature) return;
    try { window.localStorage.setItem(paymentAlertStorageKey, paymentAlertSignature); } catch { /* Storage may be unavailable. */ }
    setSeenPaymentAlertSignature(paymentAlertSignature);
  }

  useEffect(() => {
    if (!paymentAlertStorageKey) return;
    try { setSeenPaymentAlertSignature(window.localStorage.getItem(paymentAlertStorageKey) || ''); }
    catch { setSeenPaymentAlertSignature(''); }
  }, [paymentAlertStorageKey]);

  useEffect(() => {
    if (!active || !paymentAlertStorageKey || !paymentAlertSignature) return;
    try { window.localStorage.setItem(paymentAlertStorageKey, paymentAlertSignature); } catch { /* Storage may be unavailable. */ }
    setSeenPaymentAlertSignature(paymentAlertSignature);
  }, [active, paymentAlertStorageKey, paymentAlertSignature]);

  useEffect(() => {
    const client = supabase;
    if (!profile || !client) return;
    let alive = true;
    const refresh = async (showLoader: boolean) => {
      if (showLoader && alive) setLoading(true);
      const claimJob = profile.role === 'manager'
        ? client.rpc('manager_payment_month_claimed', { p_month: monthStart })
        : Promise.resolve({ data: false, error: null });
      const reopenJob = profile.role === 'manager'
        ? client.rpc('manager_payment_month_reopen_available', { p_month: monthStart })
        : Promise.resolve({ data: false, error: null });
      const managerReopenedJob = profile.role === 'manager'
        ? client.rpc('get_my_reopened_payment_months')
        : Promise.resolve({ data: [], error: null });
      const directorReopenJob = profile.role === 'managing_director'
        ? client.rpc('get_manager_payment_month_reopen_options')
        : Promise.resolve({ data: [], error: null });
      const jobs = [
        client.from('manager_payment_requests').select('*').order('month_start', { ascending: false }),
        client.from('payment_settings').select('hourly_rate_usd,late_deduction_usd').eq('id', true).maybeSingle(),
        claimJob, reopenJob, managerReopenedJob, directorReopenJob
      ] as const;
      const [requestResult, settingResult, claimResult, reopenResult, managerReopenedResult, directorReopenResult] = await Promise.all(jobs);
      if (!alive) return;
      if (profile.role === 'manager') {
        setMonthAlreadySubmitted(Boolean(claimResult.data));
        setMonthReopenAvailable(Boolean(reopenResult.data));
        if (!managerReopenedResult.error) setManagerReopenedMonths((managerReopenedResult.data || []) as ManagerReopenedMonth[]);
        else notify('Reopened months could not be loaded: ' + managerReopenedResult.error.message);
      }
      if (profile.role === 'managing_director') {
        if (!directorReopenResult.error) setReopenableMonths((directorReopenResult.data || []) as ReopenableMonth[]);
        else notify('Deleted monthly request records could not be loaded: ' + directorReopenResult.error.message);
      }
      if (requestResult.error) notify('Payment history could not load: ' + requestResult.error.message);
      else {
        const rows = (requestResult.data || []) as PaymentRequest[];
        setRequests(rows);
        if (!selectedId && rows.length) setSelectedId(rows[0].id);
        if (selectedId && !rows.some(row => row.id === selectedId)) setSelectedId(rows[0]?.id || '');
        const ids = rows.map(row => row.id);
        if (ids.length) {
          const eventResult = await client.from('manager_payment_request_events').select('*').in('request_id', ids).order('created_at', { ascending: true });
          if (alive && !eventResult.error) setEvents((eventResult.data || []) as PaymentEvent[]);
        } else setEvents([]);
      }
      if (settingResult.data) {
        const next = settingResult.data as PaymentSettings;
        setSettings(next);
        setRateDraft(String(next.hourly_rate_usd));
        setDeductionDraft(String(next.late_deduction_usd));
      }
      if (!director && profile.role === 'manager') {
        const bankResult = await client.from('manager_bank_details').select('bank_name,account_holder_name,account_number').eq('profile_id', profile.id).maybeSingle();
        if (alive && !bankDirty && bankResult.data) setBank(bankResult.data as BankForm);
        const previewResult = await client.rpc('get_manager_payment_preview_v2', { p_month: monthStart });
        if (alive) {
          if (previewResult.error) {
            setPreview(null);
            setPreviewError(previewResult.error.message);
          } else {
            setPreview((previewResult.data?.[0] || null) as PaymentPreview | null);
            setPreviewError('');
          }
        }
      }
      if (alive && showLoader) setLoading(false);
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 30000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [profile?.id, profile?.role, monthStart, selectedId, bankDirty, notify]);

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!profile || !supabase || !preview || !bank.bank_name.trim() || !bank.account_holder_name.trim() || !bank.account_number.trim()) {
      notify('Please complete all three bank details before requesting payment.');
      return;
    }
    if (!allUnfinishedTasksOptedOut) {
      notify('Complete every task assigned this month, or select each unfinished task to opt out at $1 per task.');
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc('create_manager_payment_request_v2', {
      p_month: monthStart,
      p_bank_name: bank.bank_name.trim(),
      p_account_holder: bank.account_holder_name.trim(),
      p_account_number: bank.account_number.trim(),
      p_opted_out_task_ids: optedOutTaskIds
    });
    setSubmitting(false);
    if (error) { notify('Payment request could not be submitted: ' + error.message); return; }
    const requestId = data as string;
    setSelectedId(requestId);
    setHistoricalInvoiceId('');
    setModal(null);
    setBankDirty(false);
    notify('Your monthly payment request and invoice have been submitted to the Managing Director.');
    await refreshAfterAction();
  }
  async function reopenPaymentMonth(option: ReopenableMonth) {
    if (!supabase || !director || option.reopen_allowed) return;
    const confirmed = window.confirm(
      'Allow ' + option.manager_name + ' to submit one replacement payment request for ' +
      formatMonth(option.month_start) + '? The month will lock again immediately after submission.'
    );
    if (!confirmed) return;
    setBusyAction(true);
    const { error } = await supabase.rpc('reopen_manager_payment_month', {
      p_manager_id: option.manager_id,
      p_month: option.month_start
    });
    setBusyAction(false);
    if (error) { notify('This month could not be reopened: ' + error.message); return; }
    setReopenableMonths(current => current.map(item =>
      item.manager_id === option.manager_id && item.month_start === option.month_start
        ? { ...item, reopen_allowed: true, reopen_count: item.reopen_count + 1, last_reopened_at: new Date().toISOString() }
        : item
    ));
    notify(formatMonth(option.month_start) + ' has been reopened for ' + option.manager_name + '. One replacement request is now available.');
  }

  async function refreshAfterAction() {
    const client = supabase;
    if (!client) return;
    const result = await client.from('manager_payment_requests').select('*').order('month_start', { ascending: false });
    if (!result.error && result.data) {
      const rows = result.data as PaymentRequest[];
      setRequests(rows);
      const ids = rows.map(row => row.id);
      if (ids.length) {
        const timeline = await client.from('manager_payment_request_events').select('*').in('request_id', ids).order('created_at', { ascending: true });
        if (!timeline.error) setEvents((timeline.data || []) as PaymentEvent[]);
      }
    }
  }
  async function resubmitRequest(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !managerRequest) return;
    if (!bank.bank_name.trim() || !bank.account_holder_name.trim() || !bank.account_number.trim()) {
      notify('Please complete all bank details before resubmitting.');
      return;
    }
    if (!allUnfinishedTasksOptedOut) {
      notify('Complete every task assigned this month, or select each unfinished task to opt out at $1 per task.');
      return;
    }
    setBusyAction(true);
    const { error } = await supabase.rpc('resubmit_manager_payment_request_v2', {
      p_request_id: managerRequest.id,
      p_bank_name: bank.bank_name.trim(),
      p_account_holder: bank.account_holder_name.trim(),
      p_account_number: bank.account_number.trim(),
      p_opted_out_task_ids: optedOutTaskIds
    });
    setBusyAction(false);
    if (error) { notify('The revised request could not be submitted: ' + error.message); return; }
    setModal(null);
    setBankDirty(false);
    notify('Your revised payment request has been sent.');
    await refreshAfterAction();
  }
  function openRequestModal() {
    setOptedOutTaskIds([]);
    setModal('request');
  }

  function toggleTaskOptOut(taskId: string, checked: boolean) {
    setOptedOutTaskIds(current => checked
      ? [...new Set([...current, taskId])]
      : current.filter(id => id !== taskId));
  }

  async function disputeRequest(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !managerRequest) return;
    setBusyAction(true);
    const { error } = await supabase.rpc('dispute_manager_payment_request', { p_request_id: managerRequest.id, p_note: noteDraft.trim() });
    setBusyAction(false);
    if (error) { notify('The dispute could not be submitted: ' + error.message); return; }
    setModal(null);
    setNoteDraft('');
    notify('Your dispute has been recorded for the Managing Director.');
    await refreshAfterAction();
  }
  function openFinalPayoutModal() {
    const existingAmount = selectedRequest?.director_payment_amount_pkr;
    setDirectorAmountPreset(existingAmount == null ? '10000' : 'custom');
    setDirectorAmountDraft(String(existingAmount ?? 10000));
    setDirectorReasonDraft(selectedRequest?.director_payment_reason || '');
    setModal('approve');
  }

  async function approveRequest(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedRequest || !director) return;
    const finalAmount = Number(directorAmountDraft);
    const reason = directorReasonDraft.trim();
    if (!Number.isFinite(finalAmount) || finalAmount <= 0 || finalAmount > 9999999999.99 || Math.round(finalAmount * 100) !== finalAmount * 100) {
      notify('Enter a valid final PKR amount with up to two decimal places.');
      return;
    }
    if (reason.length < 5 || reason.length > 1200) {
      notify('Add a reason of at least five characters for the final PKR amount.');
      return;
    }
    setBusyAction(true);
    const { error } = await supabase.rpc('approve_manager_payment_request', {
      p_request_id: selectedRequest.id,
      p_amount_pkr: finalAmount,
      p_reason: reason
    });
    setBusyAction(false);
    if (error) { notify('The final PKR amount could not be saved: ' + error.message); return; }
    setModal(null);
    notify('Final payout set to ' + payoutAmount(finalAmount, 'PKR') + ' and saved to the invoice.');
    await refreshAfterAction();
  }

  async function reviewRequest(action: 'request_revision', note?: string) {
    if (!supabase || !selectedRequest) return;
    setBusyAction(true);
    const { error } = await supabase.rpc('review_manager_payment_request', {
      p_request_id: selectedRequest.id,
      p_action: action,
      p_note: note || null
    });
    setBusyAction(false);
    if (error) { notify('The payment status could not be updated: ' + error.message); return; }
    setModal(null);
    setNoteDraft('');
    notify('Revision request sent to the Manager.');
    await refreshAfterAction();
  }
  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedRequest || selectedRequest.status !== 'approved') return;
    const paidAmount = Number(paidAmountDraft);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0 || paidAmount > 9999999999.99 || Math.round(paidAmount * 100) !== paidAmount * 100) {
      notify('Enter the exact payment amount, using up to two decimal places.');
      return;
    }
    if (!window.confirm('Confirm that the bank transfer has already been sent and record ' + payoutAmount(paidAmount, paidCurrencyDraft) + ' as the actual payment?')) return;
    setBusyAction(true);
    const { error } = await supabase.rpc('mark_manager_payment_request_paid', { p_request_id: selectedRequest.id, p_paid_amount: paidAmount, p_paid_currency: paidCurrencyDraft });
    setBusyAction(false);
    if (error) { notify('The payment could not be recorded: ' + error.message); return; }
    setModal(null);
    setPaidAmountDraft('');
    notify('The actual payment amount and currency have been recorded.');
    await refreshAfterAction();
  }
  async function deleteRequest() {
    if (!supabase || !selectedRequest || !director) return;
    if (!window.confirm('Permanently delete invoice ' + selectedRequest.invoice_number + '? Its invoice and request history will be removed for both users. This cannot be undone.')) return;
    setBusyAction(true);
    const { error } = await supabase.rpc('delete_manager_payment_request', { p_request_id: selectedRequest.id });
    setBusyAction(false);
    if (error) { notify('The invoice could not be deleted: ' + error.message); return; }
    setSelectedId('');
    setHistoricalInvoiceId('');
    notify('The invoice and its request history have been deleted.');
    await refreshAfterAction();
  }
  async function savePaymentSettings(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !profile || !director) return;
    const hourly = Number(rateDraft);
    const deduction = Number(deductionDraft);
    if (!Number.isFinite(hourly) || !Number.isFinite(deduction) || hourly < 0 || hourly > 1000 || deduction < 0 || deduction > 1000) {
      notify('Enter valid rates between $0 and $1,000.');
      return;
    }
    setSavingSettings(true);
    const { error } = await supabase.from('payment_settings').update({
      hourly_rate_usd: hourly, late_deduction_usd: deduction, updated_at: new Date().toISOString(), updated_by: profile.id
    }).eq('id', true);
    setSavingSettings(false);
    if (error) { notify('Payment policy could not be saved: ' + error.message); return; }
    setSettings({ hourly_rate_usd: hourly, late_deduction_usd: deduction });
    setSettingsOpen(false);
    notify('Monthly payment rates updated.');
  }

  if (!profile) return null;
  const activeForDashboard = pendingDirector.filter(request => request.status === 'requested' || request.status === 'disputed').length;
  const awaitingTransfer = pendingDirector.filter(request => request.status === 'approved').length;
  const managerHasAction = requests.some(request => request.manager_id === profile.id && request.status === 'revision_requested');

  return <>
    {paymentAlertVisible && director && pendingDirector.length > 0 && <button type="button" className="payment-dashboard-alert" onClick={() => { markPaymentAlertSeen(); onOpen(); }}>
      <span className="payment-alert-icon"><BellRing size={18} /></span><span className="payment-alert-copy"><strong>Payment approvals need your attention</strong><small>{activeForDashboard} request(s) awaiting review · {awaitingTransfer} approved invoice(s) awaiting transfer</small></span><span className="payment-alert-count">{pendingDirector.length}</span><ChevronRight size={17} />
    </button>}
    {paymentAlertVisible && !director && (managerHasAction || managerRequest || monthAlreadySubmitted || monthReopenAvailable) && <button type="button" className="payment-dashboard-alert payment-manager-alert" onClick={() => { markPaymentAlertSeen(); onOpen(); }}>
      <span className="payment-alert-icon"><AlertCircle size={18} /></span><span className="payment-alert-copy"><strong>{monthReopenAvailable ? 'The Director reopened a month for a replacement request' : managerRequest?.status === 'paid' ? 'Your payment has been recorded as paid' : managerRequest?.status === 'approved' ? 'Your payment request has been approved' : managerRequest?.status === 'requested' ? 'Your payment request has been sent to the Director' : monthAlreadySubmitted && !managerRequest ? 'This month has already been submitted' : 'A payment request needs your attention'}</strong><small>{monthReopenAvailable ? formatMonth(monthStart) + ' · You may submit one replacement request.' : managerRequest ? formatMonth(managerRequest.month_start) + ' · ' + (managerRequest.status === 'paid' && managerRequest.paid_amount != null && managerRequest.paid_currency ? payoutAmount(managerRequest.paid_amount, managerRequest.paid_currency) : statusLabel(managerRequest.status)) : monthAlreadySubmitted ? formatMonth(monthStart) + ' · This month is locked against duplicate requests.' : 'The Managing Director has requested a revision to your invoice.'}</small></span><ChevronRight size={17} />
    </button>}
    {active && <section className="payment-center">
      <header className="payment-center-heading"><div><span className="payment-eyebrow">EDI OVA · FINANCE</span><h2>{director ? 'Payment administration.' : 'Your monthly payment.'}</h2><p>{director ? 'Review submitted invoices, set the payment policy, and record completed transfers.' : 'Review your monthly work summary, request payment, and keep every invoice in one place.'}</p></div>
        {director && <button className="payment-policy-toggle" onClick={() => setSettingsOpen(!settingsOpen)}><LockKeyhole size={15} /> Payment policy <ChevronRight size={15} /></button>}
      </header>
      {!supabase && <div className="payment-empty"><AlertCircle size={20} /><strong>Connect the workspace database to use payments.</strong><p>Payment requests are available after a verified Ediova sign-in.</p></div>}
      {director && settingsOpen && <form className="payment-policy-panel" onSubmit={savePaymentSettings}>
        <div><span className="payment-eyebrow">MANAGING DIRECTOR ONLY</span><h3>Payment policy.</h3><p>These rates apply to future monthly requests. Existing invoices keep their original approved calculation.</p></div>
        <label>Hourly rate (USD)<span className="payment-input-prefix">$<input type="number" min="0" max="1000" step="0.25" value={rateDraft} onChange={event => setRateDraft(event.target.value)} /></span></label>
        <label>Deduction per delayed task (USD)<span className="payment-input-prefix">$<input type="number" min="0" max="1000" step="0.25" value={deductionDraft} onChange={event => setDeductionDraft(event.target.value)} /></span></label>
        <div className="payment-policy-actions"><button type="button" className="payment-button payment-button-light" onClick={() => setSettingsOpen(false)}>Cancel</button><button className="payment-button payment-button-primary" disabled={savingSettings}><Check size={15} /> {savingSettings ? 'Saving…' : 'Save policy'}</button></div>
      </form>}
      {director && !loading && reopenableMonths.length > 0 && <section className="payment-reopen-panel">
        <div className="payment-reopen-heading"><div><span className="payment-eyebrow">MANAGING DIRECTOR · MONTH ACCESS</span><h3>Deleted monthly requests.</h3><p>Reopen one specific month to allow its Manager to submit one replacement invoice. A month with an existing invoice cannot be reopened.</p></div><span>{reopenableMonths.length}</span></div>
        <div className="payment-reopen-list">{reopenableMonths.map(option => <div className="payment-reopen-row" key={option.manager_id + ':' + option.month_start}>
          <div><strong>{option.manager_name}</strong><span>{formatMonth(option.month_start)} · Previously submitted</span>{option.reopen_count > 0 && <small>Reopened {option.reopen_count} time(s) · {option.last_reopened_at ? formatDateTime(option.last_reopened_at) : 'Awaiting submission'}</small>}</div>
          {option.reopen_allowed
            ? <span className="payment-reopen-open"><BadgeCheck size={15} /> Open · awaiting Manager</span>
            : <button type="button" className="payment-button payment-button-primary" disabled={busyAction} onClick={() => void reopenPaymentMonth(option)}><RefreshCw size={14} /> Allow one replacement request</button>}
        </div>)}</div>
      </section>}
      {director && !loading && reopenableMonths.length === 0 && <section className="payment-reopen-panel payment-reopen-empty">
        <span className="payment-eyebrow">MONTH ACCESS</span><strong>No deleted monthly requests are waiting to be reopened.</strong>
      </section>}
      {!loading && !director && managerReopenedMonths.length > 0 && <section className="payment-manager-reopened-panel">
        <div><span className="payment-eyebrow">MANAGING DIRECTOR ACCESS</span><h3>Reopened payment months.</h3><p>Your Director has allowed one replacement request for the selected month. After submission, that month will lock again.</p></div>
        <div className="payment-manager-reopened-list">{managerReopenedMonths.map(option => <button type="button" key={option.month_start} className={monthStart === option.month_start ? 'selected' : ''} onClick={() => setMonthStart(option.month_start)}>
          <span><strong>{formatMonth(option.month_start)}</strong><small>{option.reopen_count > 1 ? 'Replacement request reopened ' + option.reopen_count + ' times' : 'One replacement request available'}</small></span>
          <span>{monthStart === option.month_start ? 'Selected' : 'Select month'}</span>
        </button>)}</div>
      </section>}
      {loading ? <div className="payment-loading"><RefreshCw size={18} /> Loading payment records…</div> : director ? <div className="payment-director-layout">
        <aside className="payment-record-sidebar">
          <div className="payment-record-heading"><div><span className="payment-eyebrow">INVOICE REGISTER</span><h3>Payment records</h3></div><span>{requests.length}</span></div>
          {requests.length ? requests.map(request => <button className={'payment-record-row' + (selectedRequest?.id === request.id ? ' selected' : '')} key={request.id} onClick={() => setSelectedId(request.id)}>
            <span className="payment-record-avatar">{request.manager_name_snapshot.split(/\s+/).map(part => part[0]).slice(0, 2).join('')}</span><span className="payment-record-copy"><strong>{request.manager_name_snapshot}</strong><small>{formatMonth(request.month_start)} · {request.invoice_number}</small><em className={'payment-status status-' + request.status}>{statusLabel(request.status)}</em></span><b>{request.status === 'paid' && request.paid_amount != null && request.paid_currency ? payoutAmount(request.paid_amount, request.paid_currency) : request.director_payment_amount_pkr != null ? payoutAmount(request.director_payment_amount_pkr, 'PKR') : amount(request.net_amount_usd)}</b>
          </button>) : <div className="payment-record-empty"><FileText size={22} /><strong>No payment requests yet.</strong><span>Submitted monthly invoices will appear here.</span></div>}
        </aside>
        <div className="payment-detail-column">
          {selectedRequest ? <><div className="payment-selected-toolbar"><div><span className="payment-eyebrow">SELECTED INVOICE</span><strong>{selectedRequest.invoice_number}</strong></div><div className="payment-toolbar-actions"><button type="button" className="payment-button payment-button-light" onClick={() => window.print()}><Printer size={15} /> Print invoice</button><button type="button" className="payment-button payment-button-danger" disabled={busyAction} onClick={() => void deleteRequest()}><Trash2 size={15} /> Delete invoice</button></div></div>
            <div className="payment-review-summary"><span className={'payment-status status-' + selectedRequest.status}>{statusLabel(selectedRequest.status)}</span><strong>{selectedRequest.director_payment_amount_pkr != null ? payoutAmount(selectedRequest.director_payment_amount_pkr, 'PKR') : amount(selectedRequest.net_amount_usd)}</strong><small>{selectedRequest.director_payment_amount_pkr != null ? 'Director-approved final payout' : 'System-suggested payment'} · {selectedRequest.manager_name_snapshot}</small><small>System reference: {amount(selectedRequest.net_amount_usd)}</small>{selectedRequest.director_payment_reason && <small className="payment-actual-paid-label">Director's reason: {selectedRequest.director_payment_reason}</small>}{selectedRequest.paid_amount != null && selectedRequest.paid_currency && <small className="payment-actual-paid-label">Actual transfer: {payoutAmount(selectedRequest.paid_amount, selectedRequest.paid_currency)}</small>}</div>
            <InvoiceDocument request={selectedRequest} managerName={selectedRequest.manager_name_snapshot} />
            <div className="payment-review-actions">
              {['requested', 'disputed'].includes(selectedRequest.status) && <button className="payment-button payment-button-primary" disabled={busyAction} onClick={openFinalPayoutModal}><Check size={15} /> Set final PKR amount &amp; approve</button>}
              {['requested', 'disputed', 'approved'].includes(selectedRequest.status) && <button className="payment-button payment-button-light" disabled={busyAction} onClick={() => { setNoteDraft(''); setModal('revision'); }}>Request revision</button>}
              {selectedRequest.status === 'approved' && <button className="payment-button payment-button-light" disabled={busyAction} onClick={openFinalPayoutModal}><Banknote size={15} /> {selectedRequest.director_payment_amount_pkr != null ? 'Edit final PKR amount' : 'Set final PKR amount'}</button>}
              {selectedRequest.status === 'approved' && selectedRequest.director_payment_amount_pkr != null && <button className="payment-button payment-button-paid" disabled={busyAction} onClick={() => { setPaidAmountDraft(String(selectedRequest.director_payment_amount_pkr)); setPaidCurrencyDraft('PKR'); setModal('payment'); }}><BadgeCheck size={15} /> Record payment</button>}
            </div>
            <div className="payment-history-panel"><div className="payment-invoice-section-title"><div><span className="payment-eyebrow">AUDIT TRAIL</span><h3>Request history.</h3></div></div>{selectedEvents.length ? selectedEvents.map(event => <EventLabel event={event} key={event.id} />) : <p className="payment-muted">No activity has been recorded.</p>}</div>
          </> : <div className="payment-empty"><FileText size={24} /><strong>Select a payment record.</strong><p>The invoice and its complete approval history will appear here.</p></div>}
        </div>
      </div> : <div className="payment-manager-layout">
        <div className="payment-manager-main">
          {managerRequest ? <>
            <div className="payment-manager-status-card"><div><span className="payment-eyebrow">MONTHLY PAYMENT REQUEST</span><h3>{formatMonth(managerRequest.month_start)}</h3><p>{managerRequest.invoice_number}</p><small>{managerRequest.status === 'requested' ? 'Your request has been sent to the Managing Director.' : managerRequest.status === 'approved' ? 'The Managing Director approved your request. The transfer is awaiting confirmation.' : managerRequest.status === 'paid' ? 'The Managing Director has recorded this payment.' : managerRequest.status === 'revision_requested' ? 'Please review the requested changes and resubmit this same invoice.' : 'Your request is under review.'}</small></div><span className={'payment-status status-' + managerRequest.status}>{statusLabel(managerRequest.status)}</span></div>
            {managerRequest.status === 'paid' && <div className="payment-paid-record"><div className="payment-paid-main"><span className="payment-eyebrow">PAID · {formatMonth(managerRequest.month_start)}</span><strong>{managerRequest.paid_amount != null && managerRequest.paid_currency ? payoutAmount(managerRequest.paid_amount, managerRequest.paid_currency) : managerRequest.director_payment_amount_pkr != null ? payoutAmount(managerRequest.director_payment_amount_pkr, 'PKR') : 'Amount not recorded on this legacy invoice'}</strong><small>Director-approved amount: {managerRequest.director_payment_amount_pkr != null ? payoutAmount(managerRequest.director_payment_amount_pkr, 'PKR') : 'Not recorded'}</small>{managerRequest.director_payment_reason && <small>Reason: {managerRequest.director_payment_reason}</small>}</div><div><span className="payment-eyebrow">SYSTEM-SUGGESTED · USD REFERENCE</span><strong className="payment-secondary-amount">{amount(managerRequest.net_amount_usd)}</strong></div></div>}
            {managerRequest.revision_note && <div className="payment-inline-note"><AlertCircle size={16} /><div><strong>Revision requested</strong><p>{managerRequest.revision_note}</p></div></div>}
            {managerRequest.dispute_note && <div className="payment-inline-note"><AlertCircle size={16} /><div><strong>Your dispute</strong><p>{managerRequest.dispute_note}</p></div></div>}
            <div className="payment-invoice-actions"><button type="button" className="payment-button payment-button-primary" onClick={() => setHistoricalInvoiceId(historicalInvoiceId === managerRequest.id ? '' : managerRequest.id)}><FileText size={15} /> {historicalInvoiceId === managerRequest.id ? 'Hide full invoice' : 'View full invoice'}</button>
              {historicalInvoiceId === managerRequest.id && <button type="button" className="payment-button payment-button-light" onClick={() => window.print()}><Printer size={15} /> Print invoice</button>}
              {managerRequest.status === 'revision_requested' && <button type="button" className="payment-button payment-button-primary" onClick={() => { setBankDirty(false); openRequestModal(); }}>Update details &amp; resubmit</button>}
              {['requested','approved'].includes(managerRequest.status) && <button type="button" className="payment-button payment-button-light" onClick={() => { setNoteDraft(''); setModal('dispute'); }}>Raise a dispute</button>}
            </div>
            {historicalInvoiceId === managerRequest.id && <><InvoiceDocument request={managerRequest} managerName={profile.full_name} /><div className="payment-history-panel"><div className="payment-invoice-section-title"><div><span className="payment-eyebrow">AUDIT TRAIL</span><h3>Request history.</h3></div></div>{events.filter(event => event.request_id === managerRequest.id).map(event => <EventLabel event={event} key={event.id} />)}</div></>}
          </> : <>
            {monthStart !== previousMonthStart() && <button type="button" className="payment-button payment-button-light payment-return-current" onClick={() => setMonthStart(previousMonthStart())}><CalendarDays size={14} /> Return to current payment month</button>}
            <div className="payment-period-card"><div><span className="payment-eyebrow">READY FOR YOUR REQUEST</span><h3>{formatMonth(monthStart)}</h3><p>{monthReopenAvailable ? 'The Managing Director reopened this month. You may submit one replacement request; it will lock again after submission.' : 'Payment requests open from the first day of the following month.'}</p></div><span className="payment-period-icon"><CalendarDays size={22} /></span></div>
            {monthAlreadySubmitted && !managerRequest ? <div className="payment-empty"><BadgeCheck size={20} /><strong>This month’s payment request has already been submitted.</strong><p>The Director removed the invoice record, but this month remains locked to prevent a duplicate request. Please contact the Managing Director if the invoice needs to be restored.</p></div> : preview ? <div className="payment-estimate-card"><div className="payment-estimate-top"><div><span className="payment-eyebrow">YOUR ESTIMATED PAYMENT</span><h3>{amount(preview.net_amount_usd)}</h3><small>Subject to the Managing Director’s review</small></div><div className="payment-estimate-icon"><CircleDollarSign size={22} /></div></div>
              <div className="payment-estimate-stats"><div><span>Credited hours</span><strong>{quantity(preview.completed_hours)} hrs</strong></div><div><span>Tasks completed</span><strong>{quantity(preview.completed_tasks)}</strong></div><div><span>Late tasks</span><strong>{quantity(preview.delayed_tasks)}</strong></div><div><span>Performance</span><strong>{quantity(preview.performance_score)}/100</strong></div></div>
              <div className="payment-calculation"><div><span>{quantity(preview.completed_hours)} hours × {amount(preview.hourly_rate_usd)}</span><strong>{amount(preview.gross_amount_usd)}</strong></div><div><span>{quantity(preview.delayed_tasks)} late tasks × {amount(preview.late_deduction_usd)}</span><strong>−{amount(preview.deductions_usd)}</strong></div>{unfinishedTasks.length > 0 && <div className="payment-unfinished-preview-line"><span>{quantity(unfinishedTasks.length)} unfinished task(s) · optional opt-out at $1 each</span><strong>Up to −{amount(unfinishedOptOutTotal)}</strong></div>}<div><span>VAT · 0.00%</span><strong>{amount(0)}</strong></div><div className="payment-calculation-total"><span>Estimated payment before unfinished-task opt-outs</span><strong>{amount(preview.net_amount_usd)}</strong></div></div>
              <button type="button" className="payment-button payment-button-primary payment-request-cta" onClick={openRequestModal}><Wallet size={16} /> Request payment <ArrowRight size={16} /></button>
            </div> : <div className="payment-empty"><AlertCircle size={20} /><strong>{previewError ? 'Monthly estimate is not available yet.' : 'Your estimate is being prepared.'}</strong><p>{previewError ? 'The payment period is the previous completed calendar month. The request becomes available from the first day of the new month.' : 'Complete and credited task hours will appear here.'}</p></div>}
            <div className="payment-bank-hint"><Banknote size={18} /><div><strong>Pakistani bank account</strong><p>When you request payment, add your bank name, account holder name, and account number. You can review the details on the invoice before submitting.</p></div></div>
          </>}
          {historicalInvoice && historicalInvoice.id !== managerRequest?.id && <section className="payment-archive-panel"><div className="payment-selected-toolbar"><div><span className="payment-eyebrow">ARCHIVED INVOICE</span><strong>{historicalInvoice.invoice_number}</strong></div><button type="button" className="payment-button payment-button-light" onClick={() => setHistoricalInvoiceId('')}><X size={14} /> Close</button></div><div className="payment-review-summary"><span className={'payment-status status-' + historicalInvoice.status}>{statusLabel(historicalInvoice.status)}</span><strong>{historicalInvoice.director_payment_amount_pkr != null ? payoutAmount(historicalInvoice.director_payment_amount_pkr, 'PKR') : amount(historicalInvoice.net_amount_usd)}</strong><small>{formatMonth(historicalInvoice.month_start)} · {historicalInvoice.director_payment_amount_pkr != null ? 'Director-approved final payout' : 'System-suggested payment'}</small><small>System reference: {amount(historicalInvoice.net_amount_usd)}</small>{historicalInvoice.paid_amount != null && historicalInvoice.paid_currency && <small className="payment-actual-paid-label">Actual transfer: {payoutAmount(historicalInvoice.paid_amount, historicalInvoice.paid_currency)}</small>}</div><button type="button" className="payment-button payment-button-light" onClick={() => window.print()}><Printer size={15} /> Print invoice</button><InvoiceDocument request={historicalInvoice} managerName={profile.full_name} /><div className="payment-history-panel"><div className="payment-invoice-section-title"><div><span className="payment-eyebrow">AUDIT TRAIL</span><h3>Request history.</h3></div></div>{events.filter(event => event.request_id === historicalInvoice.id).map(event => <EventLabel event={event} key={event.id} />)}</div></section>}
        </div>
        <aside className="payment-manager-aside">
          <div className="payment-aside-card"><span className="payment-eyebrow">PAYMENT POLICY</span><h3>Clear work. Clear pay.</h3><div className="payment-policy-line"><span>Hourly rate</span><strong>{amount(settings.hourly_rate_usd)} / hr</strong></div><div className="payment-policy-line"><span>Late deduction</span><strong>{amount(settings.late_deduction_usd)} / task</strong></div><p>One deduction applies when a task is more than 24 hours past its deadline. The calculation is shown on your invoice.</p></div>
          <div className="payment-aside-card payment-privacy-card"><LockKeyhole size={17} /><div><strong>Your information stays private.</strong><p>Your bank details and payment history are visible only to you and the Managing Director.</p></div></div>
          {requests.length > 0 && <div className="payment-aside-card"><span className="payment-eyebrow">PAST PAYMENT RECORDS</span><div className="payment-mini-history">{requests.map(request => <button type="button" key={request.id} className={historicalInvoiceId === request.id ? 'active' : ''} onClick={() => setHistoricalInvoiceId(historicalInvoiceId === request.id ? '' : request.id)}><span><strong>{formatMonth(request.month_start)}</strong><small>{request.invoice_number} · {statusLabel(request.status)}</small></span><b>{request.status === 'paid' && request.paid_amount != null && request.paid_currency ? payoutAmount(request.paid_amount, request.paid_currency) : request.director_payment_amount_pkr != null ? payoutAmount(request.director_payment_amount_pkr, 'PKR') : amount(request.net_amount_usd)}</b></button>)}</div></div>}
        </aside>
      </div>}
    </section>}
    {modal && <div className="payment-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}>
      <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
        <div className="payment-modal-heading"><div><span className="payment-eyebrow">{modal === 'request' ? 'PAYMENT REQUEST' : modal === 'dispute' ? 'PAYMENT REVIEW' : modal === 'payment' ? 'RECORD BANK TRANSFER' : modal === 'approve' ? 'DIRECTOR FINAL PAYOUT' : 'MANAGING DIRECTOR REVIEW'}</span><h2 id="payment-modal-title">{modal === 'request' ? (managerRequest ? 'Update bank details.' : 'Request payment.') : modal === 'dispute' ? 'Raise a dispute.' : modal === 'payment' ? 'Record actual payment.' : modal === 'approve' ? 'Set the final PKR amount.' : 'Request a revision.'}</h2></div><button type="button" className="payment-icon-button" onClick={() => setModal(null)} aria-label="Close"><X size={17} /></button></div>
        {modal === 'request' ? <form onSubmit={managerRequest ? resubmitRequest : submitRequest}>
          <p className="payment-modal-copy">The invoice will include your monthly completed hours, task details, late-task deductions, and bank information.</p>
          {unfinishedTasks.length > 0 && <section className="payment-unfinished-panel" aria-label="Unfinished tasks requiring an opt-out decision"><div className="payment-unfinished-heading"><div><strong>Unfinished tasks in this assigned month</strong><p>Every task must be completed before requesting payment, or explicitly opted out below. Each opted-out task reduces this invoice by $1.00.</p></div><span className="payment-unfinished-count">{optedOutTaskIds.length}/{unfinishedTasks.length} selected</span></div><div className="payment-unfinished-list">{unfinishedTasks.map(task => <label className="payment-unfinished-item" key={task.task_id}><input type="checkbox" checked={optedOutTaskIds.includes(task.task_id)} onChange={event => toggleTaskOptOut(task.task_id, event.target.checked)} /><span><strong>{task.title}</strong><small>{task.status === 'in_progress' ? 'In progress' : 'Not started'} · Due {formatDateTime(task.deadline_at)}</small></span><b>−$1.00</b></label>)}</div><div className="payment-unfinished-total"><span>Opt-out deduction if submitted now</span><strong>−{amount(optedOutTaskIds.length)}</strong></div>{!allUnfinishedTasksOptedOut && <p className="payment-unfinished-required">Select every unfinished task or complete it before this request can be submitted.</p>}</section>}
          <label>Bank name<input required maxLength={120} value={bank.bank_name} onChange={event => { setBank({ ...bank, bank_name: event.target.value }); setBankDirty(true); }} placeholder="e.g. Meezan Bank" /></label>
          <label>Account holder name<input required maxLength={160} value={bank.account_holder_name} onChange={event => { setBank({ ...bank, account_holder_name: event.target.value }); setBankDirty(true); }} placeholder="Full name as registered with the bank" /></label>
          <label>Bank account number<input required maxLength={80} value={bank.account_number} onChange={event => { setBank({ ...bank, account_number: event.target.value }); setBankDirty(true); }} placeholder="Enter your account number" /></label>
          <div className="payment-modal-safe"><LockKeyhole size={14} /><span>These details are saved securely to your Ediova profile and copied to this invoice.</span></div>
          <div className="payment-modal-actions"><button type="button" className="payment-button payment-button-light" onClick={() => setModal(null)}>Cancel</button><button className="payment-button payment-button-primary" disabled={submitting || busyAction || !allUnfinishedTasksOptedOut}>{submitting || busyAction ? 'Submitting…' : managerRequest ? 'Resubmit invoice' : 'Create invoice & request payment'} <ArrowRight size={15} /></button></div>
        </form> : modal === 'dispute' ? <form onSubmit={disputeRequest}>
          <p className="payment-modal-copy">Explain which part of the invoice you believe needs a review. Your note will be added to the request history for the Managing Director.</p>
          <label>Reason for dispute<textarea required minLength={5} maxLength={1200} rows={4} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="Describe the hours, task record, or deduction you would like reviewed…" /></label>
          <div className="payment-modal-actions"><button type="button" className="payment-button payment-button-light" onClick={() => setModal(null)}>Cancel</button><button className="payment-button payment-button-primary" disabled={busyAction}>Submit dispute</button></div>
        </form> : modal === 'approve' ? <form onSubmit={approveRequest}>
          <p className="payment-modal-copy">Choose the final amount the Manager will be paid in PKR. This becomes the large, primary amount on the invoice. The original USD calculation remains underneath as a smaller system reference.</p>
          <div className="payment-amount-presets" role="group" aria-label="Final payment amount presets">
            {(['10000', '12000', '15000'] as const).map(value => <button type="button" key={value} className={directorAmountPreset === value ? 'selected' : ''} onClick={() => { setDirectorAmountPreset(value); setDirectorAmountDraft(value); }}>PKR {Number(value).toLocaleString('en-US')}</button>)}
            <button type="button" className={directorAmountPreset === 'custom' ? 'selected' : ''} onClick={() => setDirectorAmountPreset('custom')}>Custom amount</button>
          </div>
          <label>Final amount (PKR)<input required type="number" min="0.01" max="9999999999.99" step="0.01" readOnly={directorAmountPreset !== 'custom'} value={directorAmountDraft} onChange={event => { setDirectorAmountDraft(event.target.value); setDirectorAmountPreset('custom'); }} /></label>
          <label>Director's reason for this amount<textarea required minLength={5} maxLength={1200} rows={4} value={directorReasonDraft} onChange={event => setDirectorReasonDraft(event.target.value)} placeholder="Explain why this final PKR amount is being set instead of the system-suggested USD total…" /></label>
          <div className="payment-modal-safe"><LockKeyhole size={14} /><span>This decision and its reason will be saved on the invoice and in the audit history. The original USD calculation will not be changed.</span></div>
          <div className="payment-modal-actions"><button type="button" className="payment-button payment-button-light" onClick={() => setModal(null)}>Cancel</button><button className="payment-button payment-button-primary" disabled={busyAction || !directorAmountDraft || directorReasonDraft.trim().length < 5}>{busyAction ? 'Saving…' : selectedRequest?.status === 'approved' ? 'Save final PKR amount' : 'Approve with final PKR amount'}</button></div>
        </form> : modal === 'payment' ? <form onSubmit={recordPayment}>
          <p className="payment-modal-copy">The approved invoice amount is {selectedRequest?.director_payment_amount_pkr != null ? payoutAmount(selectedRequest.director_payment_amount_pkr, 'PKR') : 'not yet set'}. Enter the amount that was actually transferred.</p>
          <label>Actual amount paid<input required type="number" min="0.01" max="9999999999.99" step="0.01" value={paidAmountDraft} onChange={event => setPaidAmountDraft(event.target.value)} placeholder="Enter the amount transferred" /></label>
          <label>Payment currency<select value={paidCurrencyDraft} onChange={event => setPaidCurrencyDraft(event.target.value as 'USD' | 'PKR')}><option value="PKR">PKR · Pakistani Rupee</option><option value="USD">USD · US Dollar</option></select></label>
          <div className="payment-modal-safe"><LockKeyhole size={14} /><span>Only the Managing Director can record the final amount. Confirm that the bank transfer has already been sent.</span></div>
          <div className="payment-modal-actions"><button type="button" className="payment-button payment-button-light" onClick={() => setModal(null)}>Cancel</button><button className="payment-button payment-button-paid" disabled={busyAction || !paidAmountDraft}>{busyAction ? 'Recording…' : 'Confirm payment received'}</button></div>
        </form> : <form onSubmit={event => { event.preventDefault(); void reviewRequest('request_revision', noteDraft.trim()); }}>
          <p className="payment-modal-copy">Tell the Manager what needs to be corrected. The invoice will move to “Revision requested” until updated and resubmitted.</p>
          <label>Revision instructions<textarea required minLength={5} maxLength={1200} rows={4} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="Explain the information that needs to be corrected…" /></label>
          <div className="payment-modal-actions"><button type="button" className="payment-button payment-button-light" onClick={() => setModal(null)}>Cancel</button><button className="payment-button payment-button-primary" disabled={busyAction}>Send revision request</button></div>
        </form>}
      </section>
    </div>}
  </>;
}
