import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Droplets,
  Hammer,
  LayoutDashboard,
  MapPin,
  Menu,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  Paintbrush,
  Phone,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Thermometer,
  ToolCase,
  TrendingUp,
  UserRound,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocation, useParams, Link, Route, Switch, Router as WouterRouter } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  BookingStatusInputStatus,
  getGetBookingQueryKey,
  getListTechniciansQueryKey,
  useCreateBooking,
  useCreateServiceRequest,
  useGetBooking,
  useGetDashboardSummary,
  useListServiceRequests,
  useListServices,
  useListTechnicians,
  useUpdateBookingStatus,
} from '@workspace/api-client-react';
import type { Booking } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const money = (value: number) => `ETB ${new Intl.NumberFormat('en-US').format(value)}`;
const shortDate = (value?: string) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)) : 'Recently';
const titleCase = (value?: string) => value?.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Pending';

function IconFor({ name, size = 22 }: { name?: string; size?: number }) {
  const props = { size, strokeWidth: 1.8 };
  if (name?.toLowerCase().includes('droplet') || name?.toLowerCase().includes('water')) return <Droplets {...props} />;
  if (name?.toLowerCase().includes('paint')) return <Paintbrush {...props} />;
  if (name?.toLowerCase().includes('heat') || name?.toLowerCase().includes('ac')) return <Thermometer {...props} />;
  if (name?.toLowerCase().includes('elect')) return <Zap {...props} />;
  if (name?.toLowerCase().includes('clean')) return <Sparkles {...props} />;
  if (name?.toLowerCase().includes('hammer') || name?.toLowerCase().includes('carpent')) return <Hammer {...props} />;
  return <Wrench {...props} />;
}

function LoadingBlock({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-3" data-testid="loading-state">{Array.from({ length: lines }).map((_, index) => <div key={index} className={`shimmer h-14 rounded-2xl ${index === 0 ? 'w-4/5' : 'w-full'}`} />)}</div>;
}

function ErrorBlock({ label = 'We could not load this just now.', retry }: { label?: string; retry?: () => void }) {
  return <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive" data-testid="error-state">
    <div className="flex items-center gap-3"><CircleAlert size={18} /><span>{label}</span></div>
    {retry && <button data-testid="button-retry" onClick={retry} className="mt-3 font-semibold underline underline-offset-4">Try again</button>}
  </div>;
}

function EmptyBlock({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center" data-testid="empty-state">
    <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-secondary text-primary"><PackageCheck size={20} /></div>
    <h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{detail}</p>
  </div>;
}

function Mark() {
  return <Link href="/" data-testid="link-brand" className="group flex items-center gap-3">
    <span className="relative grid size-10 place-items-center rounded-[14px] bg-accent text-primary shadow-[4px_4px_0_hsl(var(--primary)/.16)] transition-transform group-hover:-translate-y-0.5"><span className="absolute size-4 rounded-full border-[3px] border-primary" /><span className="absolute h-2.5 w-[3px] -translate-y-3 rounded-full bg-primary" /><span className="absolute h-2.5 w-[3px] translate-y-3 rounded-full bg-primary" /></span>
    <span className="display-font text-[28px] leading-none tracking-tight">melse</span>
  </Link>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = [{ href: '/', label: 'Find a service', icon: Search }, { href: '/technician', label: 'Technician view', icon: ToolCase }, { href: '/admin', label: 'Operations', icon: LayoutDashboard }];
  return <div className="noise min-h-[100dvh] bg-background text-foreground">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[250px] flex-col bg-sidebar px-5 py-7 text-sidebar-foreground md:flex">
      <Mark />
      <div className="mt-14 px-3"><p className="mono-font text-[10px] uppercase tracking-[.2em] text-sidebar-foreground/45">Your local desk</p>
        <nav className="mt-5 space-y-1">{nav.map(({ href, label, icon: NavIcon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${location === href ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}`}><NavIcon size={17} strokeWidth={1.7} />{label}</Link>)}</nav>
      </div>
      <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/60 p-4"><div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-sidebar-primary" /> Every pro is checked</div><p className="mt-2 text-xs leading-relaxed text-sidebar-foreground/55">Melse coordinates the details, so you can focus on home.</p></div>
      <div className="mt-5 flex items-center gap-3 border-t border-sidebar-border pt-5"><div className="grid size-9 place-items-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">AM</div><div><p className="text-sm font-semibold">Aster M.</p><p className="text-xs text-sidebar-foreground/50">Addis Ababa</p></div><MoreHorizontal size={17} className="ml-auto text-sidebar-foreground/45" /></div>
    </aside>
    <div className="md:pl-[250px]">
      <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md md:px-10">
        <div className="md:hidden"><Mark /></div><div className="hidden md:block"><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Tuesday · Addis Ababa</p></div>
        <div className="flex items-center gap-2"><button onClick={() => window.alert('You are all caught up.')} data-testid="button-notifications" className="grid size-10 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary hover:text-primary"><Bell size={18} /></button><button data-testid="button-mobile-menu" onClick={() => setMenuOpen(!menuOpen)} className="grid size-10 place-items-center rounded-full border border-border bg-card md:hidden">{menuOpen ? <X size={18} /> : <Menu size={18} />}</button></div>
      </header>
      {menuOpen && <div className="absolute right-4 top-[68px] z-30 w-56 rounded-2xl border border-border bg-card p-2 shadow-xl md:hidden">{nav.map(({ href, label }) => <Link key={href} onClick={() => setMenuOpen(false)} href={href} data-testid={`link-mobile-${label.toLowerCase().replaceAll(' ', '-')}`} className="block rounded-xl px-3 py-3 text-sm hover:bg-secondary">{label}</Link>)}</div>}
      <main className="page-in mx-auto max-w-[1320px] px-5 py-8 md:px-10 md:py-11">{children}</main>
    </div>
  </div>;
}

function Home() {
  const services = useListServices();
  const summary = useGetDashboardSummary();
  const requests = useListServiceRequests();
  const active = summary.data?.activeBooking;
  const recent = summary.data?.recentRequests ?? requests.data ?? [];
  return <div className="space-y-12">
    <section className="relative overflow-hidden rounded-[28px] bg-primary px-6 py-9 text-primary-foreground shadow-[8px_8px_0_hsl(var(--accent)/.55)] md:px-12 md:py-12">
      <div className="absolute -right-20 -top-24 size-80 rounded-full border-[36px] border-primary-foreground/5" /><div className="absolute -bottom-40 right-24 size-72 rounded-full border-[20px] border-accent/20" />
      <div className="relative max-w-2xl"><div className="rise-1 mb-5 flex items-center gap-2 text-xs font-semibold text-accent"><span className="size-2 rounded-full bg-accent" />LOCAL HELP, WITHOUT THE GUESSWORK</div><h1 className="rise-2 display-font text-5xl leading-[.94] tracking-tight md:text-7xl">Something at home<br /><em>needs attention?</em></h1><p className="rise-3 mt-6 max-w-lg text-base leading-relaxed text-primary-foreground/70 md:text-lg">Tell us what is happening. We’ll connect you with a verified local professional and stay close until it’s sorted.</p><a href="#services" data-testid="link-start-request" className="rise-3 mt-8 inline-flex items-center gap-3 rounded-full bg-accent px-5 py-3.5 text-sm font-bold text-primary transition hover:-translate-y-0.5">Start a request <ArrowRight size={17} /></a></div>
    </section>
    {active && <ActiveBookingCard booking={active} />}
    <section id="services" className="scroll-mt-28">
      <div className="mb-5 flex items-end justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">01 / What can we sort out?</p><h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Start with a service</h2></div><span className="hidden text-sm text-muted-foreground sm:block">Clear prices · trusted people</span></div>
      {services.isLoading ? <LoadingBlock lines={4} /> : services.isError ? <ErrorBlock retry={() => services.refetch()} /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(services.data ?? []).map((service) => <Link href={`/request/${service.slug}`} key={service.id} data-testid={`card-service-${service.id}`} className="group relative min-h-[152px] overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[5px_5px_0_hsl(var(--accent))]"><div className="flex items-start justify-between"><div className="grid size-11 place-items-center rounded-xl bg-secondary text-primary transition-transform group-hover:rotate-[-6deg]"><IconFor name={service.icon} /></div><ArrowRight size={18} className="text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div><h3 className="mt-5 font-semibold">{service.name}</h3><p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{service.description}</p><p className="mono-font mt-3 text-[10px] text-muted-foreground">FROM {money(service.startingPrice)} · {service.arrival}</p></Link>)}</div>}
    </section>
    <section className="grid gap-7 lg:grid-cols-[1.1fr_.9fr]">
      <div><div className="mb-5"><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">02 / In your orbit</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Your recent requests</h2></div>{requests.isLoading && !recent.length ? <LoadingBlock lines={2} /> : requests.isError && !recent.length ? <ErrorBlock retry={() => requests.refetch()} /> : recent.length ? <div className="divide-y divide-border rounded-2xl border border-border bg-card">{recent.slice(0, 4).map((request) => <Link href={`/technicians/${request.id}`} key={request.id} data-testid={`row-request-${request.id}`} className="flex items-center gap-4 p-4 transition hover:bg-secondary/45"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><IconFor name={request.serviceSlug} size={18} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{request.problem}</p><p className="mt-1 text-xs text-muted-foreground">{request.address} · {shortDate(request.createdAt)}</p></div><div className="hidden text-right sm:block"><p className="mono-font text-xs">{money(request.priceMin)}–{money(request.priceMax)}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{request.arrival}</p></div><ChevronRight size={17} className="text-muted-foreground" /></Link>)}</div> : <EmptyBlock title="No requests yet" detail="When something needs a hand, it will show up here." />}</div>
      <div className="rounded-2xl border border-border bg-secondary/55 p-6"><div className="flex items-center justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">The Melse promise</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">A safe pair of hands.</h2></div><ShieldCheck size={28} className="text-primary" /></div><div className="mt-7 grid grid-cols-3 gap-3">{[['verifiedProfessionals', 'pros verified'], ['averageRating', 'average rating'], ['guarantee', 'work guarantee']].map(([key, label]) => <div key={key}><p data-testid={`trust-${key}`} className="display-font text-2xl text-primary">{summary.data?.trustStats?.[key as 'verifiedProfessionals' | 'averageRating' | 'guarantee'] ?? '—'}</p><p className="mt-1 text-[11px] leading-tight text-muted-foreground">{label}</p></div>)}</div><div className="mt-7 flex items-start gap-3 border-t border-border/70 pt-5"><MapPin size={16} className="mt-0.5 shrink-0 text-primary" /><p className="text-sm leading-relaxed text-muted-foreground">Serving <strong className="font-semibold text-foreground">{summary.data?.savedAddress || 'Addis Ababa'}</strong>. We’ll use this for your next request.</p></div></div>
    </section>
  </div>;
}

function ActiveBookingCard({ booking }: { booking: Booking | null | undefined }) {
  if (!booking) return null;
  return <Link href={`/booking/${booking.id}`} data-testid={`card-active-booking-${booking.id}`} className="group flex flex-col gap-5 rounded-2xl border border-accent/50 bg-accent/15 p-5 transition hover:-translate-y-0.5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><div className="relative grid size-12 place-items-center rounded-2xl bg-primary text-accent"><Wrench size={21} /><span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-background bg-accent" /></div><div><div className="flex items-center gap-2"><span className="mono-font text-[10px] uppercase tracking-[.15em] text-primary">Live booking</span><span className="size-1 rounded-full bg-primary" /><span className="text-xs text-muted-foreground">{titleCase(booking.status)}</span></div><h3 className="mt-1 font-semibold">{booking.serviceName} with {booking.technicianName}</h3><p className="mt-1 text-sm text-muted-foreground">{booking.eta} · {booking.address}</p></div></div><div className="flex items-center gap-4 sm:text-right"><div className="hidden sm:block"><p className="mono-font text-xs">{money(booking.priceMin)}–{money(booking.priceMax)}</p><div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-primary/15"><div className="h-full rounded-full bg-primary" style={{ width: `${booking.progress}%` }} /></div></div><ArrowRight size={18} className="text-primary transition-transform group-hover:translate-x-1" /></div></Link>;
}

const issueSets: Record<string, string[]> = { plumbing: ['Leaking pipe or tap', 'Blocked sink or drain', 'No water / low pressure', 'Install or replace fixture'], electrical: ['Power outage at home', 'Faulty socket or switch', 'Lights flickering', 'Install a light or appliance'], cleaning: ['Deep clean my home', 'Move-in / move-out clean', 'Kitchen or bathroom clean', 'Regular home cleaning'], painting: ['Paint one room', 'Paint the whole home', 'Repair walls first', 'Touch-up / refresh'], carpentry: ['Fix a door or cabinet', 'Build a shelf or unit', 'Repair furniture', 'Something else'] };

function RequestFlow() {
  const { serviceSlug = '' } = useParams<{ serviceSlug: string }>();
  const services = useListServices();
  const create = useCreateServiceRequest();
  const [, setLocation] = useLocation();
  const service = services.data?.find((item) => item.slug === serviceSlug);
  const [step, setStep] = useState(1);
  const [problem, setProblem] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [urgency, setUrgency] = useState('Today');
  const issues = issueSets[serviceSlug] ?? ['Tell us what needs attention', 'Repair or replacement', 'Installation', 'Something else'];
  const canNext = step === 1 ? !!problem : step === 2 ? description.trim().length > 5 : !!address.trim();
  const submit = () => create.mutate({ data: { serviceSlug, problem, description, address, urgency } }, { onSuccess: (request) => setLocation(`/technicians/${request.id}`) });
  return <div className="mx-auto max-w-3xl">
    <Link href="/" data-testid="link-back-home" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"><ChevronLeft size={16} /> Back to services</Link>
    <div className="mb-10"><div className="flex items-center gap-2">{[1, 2, 3].map((number) => <span key={number} className={`h-1.5 flex-1 rounded-full transition-colors ${number <= step ? 'bg-accent' : 'bg-border'}`} />)}</div><p className="mono-font mt-5 text-[10px] uppercase tracking-[.18em] text-muted-foreground">Request help · 0{step} of 03</p><h1 className="mt-3 display-font text-5xl leading-none md:text-6xl">{service?.name || 'A little help'}<br /><em>{step === 1 ? 'starts with a detail.' : step === 2 ? 'give us the picture.' : 'we’ll take it from here.'}</em></h1></div>
    {services.isLoading ? <LoadingBlock lines={3} /> : services.isError ? <ErrorBlock retry={() => services.refetch()} /> : <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm md:p-8">
      {step === 1 && <div><p className="mb-5 text-sm text-muted-foreground">Which of these sounds closest?</p><div className="grid gap-3 sm:grid-cols-2">{issues.map((issue) => <button key={issue} onClick={() => setProblem(issue)} data-testid={`button-problem-${issue.toLowerCase().replaceAll(' ', '-')}`} className={`flex items-center justify-between rounded-2xl border p-4 text-left text-sm font-semibold transition ${problem === issue ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/50 hover:bg-secondary'}`}><span>{issue}</span>{problem === issue ? <Check size={17} /> : <Plus size={17} className="text-muted-foreground" />}</button>)}</div></div>}
      {step === 2 && <div><label htmlFor="request-description" className="text-sm font-semibold">What should the professional know?</label><p className="mt-1 text-sm text-muted-foreground">A few details help us send the right person first time.</p><textarea id="request-description" data-testid="input-request-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="For example: water is dripping under the kitchen sink..." className="mt-5 min-h-44 w-full resize-none rounded-2xl border border-input bg-background p-4 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-accent/20" /><p className="mt-2 text-right text-xs text-muted-foreground">{description.length} characters</p></div>}
      {step === 3 && <div className="space-y-7"><div><label htmlFor="request-address" className="text-sm font-semibold">Where should we come?</label><div className="relative mt-3"><MapPin size={18} className="absolute left-4 top-4 text-primary" /><input id="request-address" data-testid="input-request-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="House, building, area in Addis Ababa" className="h-14 w-full rounded-2xl border border-input bg-background pl-11 pr-4 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-accent/20" /></div></div><div><p className="text-sm font-semibold">How quickly do you need help?</p><div className="mt-3 grid gap-3 sm:grid-cols-3">{['Today', 'This week', 'Just planning'].map((item) => <button key={item} onClick={() => setUrgency(item)} data-testid={`button-urgency-${item.toLowerCase().replaceAll(' ', '-')}`} className={`rounded-2xl border px-4 py-4 text-left text-sm transition ${urgency === item ? 'border-primary bg-secondary font-semibold text-primary' : 'border-border hover:border-primary/50'}`}><Clock3 size={17} className="mb-3" /><span>{item}</span></button>)}</div></div><div className="flex gap-3 rounded-2xl bg-secondary/65 p-4 text-sm text-muted-foreground"><ShieldCheck className="shrink-0 text-primary" size={18} /><p>We’ll show you verified professionals and a clear ETB estimate before any booking.</p></div></div>}
      <div className="mt-8 flex items-center justify-between border-t border-border pt-5"><button data-testid="button-request-back" onClick={() => setStep(Math.max(1, step - 1))} className={`text-sm font-semibold ${step === 1 ? 'invisible' : ''}`}>Back</button>{step < 3 ? <button disabled={!canNext} data-testid="button-request-next" onClick={() => setStep(step + 1)} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35">Continue <ChevronRight size={17} /></button> : <button disabled={!canNext || create.isPending} data-testid="button-submit-request" onClick={submit} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35">{create.isPending ? 'Sending...' : 'See trusted professionals'} <ArrowRight size={17} /></button>}</div>
      {create.isError && <p className="mt-4 text-right text-sm text-destructive" data-testid="text-request-error">We couldn’t send that. Please try again.</p>}
    </div>}
  </div>;
}

function TechnicianPicker() {
  const { requestId = '' } = useParams<{ requestId: string }>();
  const technicians = useListTechnicians({ requestId }, { query: { queryKey: getListTechniciansQueryKey({ requestId }) } });
  const requests = useListServiceRequests();
  const create = useCreateBooking();
  const [, setLocation] = useLocation();
  const request = requests.data?.find((item) => item.id === requestId);
  const [selected, setSelected] = useState('');
  const available = technicians.data?.filter((tech) => tech.available) ?? [];
  const book = () => create.mutate({ data: { requestId, technicianId: selected } }, { onSuccess: (booking) => setLocation(`/booking/${booking.id}`) });
  return <div className="mx-auto max-w-4xl">
    <Link href="/" data-testid="link-technicians-back" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /> Home</Link>
    <div className="mb-9 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Your shortlist</p><h1 className="mt-3 display-font text-5xl leading-none md:text-6xl">Good people,<br /><em>close by.</em></h1></div><div className="rounded-2xl bg-secondary px-4 py-3 text-sm"><p className="text-muted-foreground">Your request</p><p className="mt-1 font-semibold">{request?.problem || 'Home service request'}</p></div></div>
    {technicians.isLoading ? <LoadingBlock lines={3} /> : technicians.isError ? <ErrorBlock retry={() => technicians.refetch()} /> : !available.length ? <EmptyBlock title="No one is available right now" detail="Try again in a little while and we’ll look across Addis." /> : <><div className="space-y-3">{available.map((tech) => <button key={tech.id} onClick={() => setSelected(tech.id)} data-testid={`card-technician-${tech.id}`} className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition md:p-5 ${selected === tech.id ? 'border-primary bg-secondary shadow-[4px_4px_0_hsl(var(--accent))]' : 'border-border bg-card hover:-translate-y-0.5 hover:border-primary/40'}`}><div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-sm font-bold text-accent">{tech.initials}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{tech.name}</h3>{tech.verified && <span className="inline-flex items-center gap-1 rounded-full bg-accent/30 px-2 py-1 text-[10px] font-bold text-primary"><BadgeCheck size={12} /> Verified</span>}</div><p className="mt-1 text-sm text-muted-foreground">{tech.specialty}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1 text-foreground"><Star size={13} className="fill-accent text-accent" /> {tech.rating} <span className="text-muted-foreground">({tech.reviews})</span></span><span>{tech.distance} away</span><span>Arrives {tech.eta}</span></div></div><div className="hidden text-right sm:block"><p className="mono-font text-xs text-primary">{tech.earnings}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">typical visit</p></div>{selected === tech.id && <div className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"><Check size={15} /></div>}</button>)}</div><div className="sticky bottom-4 mt-7 flex items-center justify-between gap-4 rounded-2xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur-md"><p className="hidden text-sm text-muted-foreground sm:block">{selected ? 'A good match for your request.' : 'Choose a professional to continue.'}</p><button disabled={!selected || create.isPending} onClick={book} data-testid="button-book-technician" className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35">{create.isPending ? 'Booking...' : 'Book this professional'} <ArrowRight size={16} /></button></div>{create.isError && <p className="mt-3 text-right text-sm text-destructive" data-testid="text-booking-error">We couldn’t make that booking. Please try again.</p>}</>}
  </div>;
}

const statusOrder: Array<'REQUESTED' | 'SEARCHING' | 'ASSIGNED' | 'ACCEPTED' | 'TECHNICIAN_EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CUSTOMER_CONFIRMED' | 'PAID' | 'RATED'> = [BookingStatusInputStatus.REQUESTED, BookingStatusInputStatus.SEARCHING, BookingStatusInputStatus.ASSIGNED, BookingStatusInputStatus.ACCEPTED, BookingStatusInputStatus.TECHNICIAN_EN_ROUTE, BookingStatusInputStatus.ARRIVED, BookingStatusInputStatus.IN_PROGRESS, BookingStatusInputStatus.COMPLETED, BookingStatusInputStatus.CUSTOMER_CONFIRMED, BookingStatusInputStatus.PAID, BookingStatusInputStatus.RATED];
function BookingPage() {
  const { id = '' } = useParams<{ id: string }>();
  const bookingQuery = useGetBooking(id, { query: { enabled: !!id, queryKey: getGetBookingQueryKey(id) } });
  const update = useUpdateBookingStatus();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const booking = bookingQuery.data;
  const currentIndex = booking ? statusOrder.indexOf(booking.status as typeof statusOrder[number]) : 0;
  const nextStatus = booking && currentIndex >= 0 ? statusOrder[Math.min(currentIndex + 1, statusOrder.length - 1)] : undefined;
  const advance = () => nextStatus && update.mutate({ id, data: { status: nextStatus } }, { onSuccess: (updated) => queryClient.setQueryData(getGetBookingQueryKey(id), updated) });
  if (bookingQuery.isLoading) return <div className="mx-auto max-w-3xl"><LoadingBlock lines={5} /></div>;
  if (bookingQuery.isError || !booking) return <div className="mx-auto max-w-3xl"><ErrorBlock label="We couldn't find this booking." retry={() => bookingQuery.refetch()} /></div>;
  const completed = booking.status === BookingStatusInputStatus.COMPLETED || booking.status === BookingStatusInputStatus.CUSTOMER_CONFIRMED || booking.status === BookingStatusInputStatus.PAID || booking.status === BookingStatusInputStatus.RATED;
  return <div className="mx-auto max-w-4xl">
    <Link href="/" data-testid="link-booking-home" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /> Home</Link>
    <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Booking #{booking.id.slice(-6)}</p><h1 className="mt-3 display-font text-5xl leading-none md:text-6xl">{completed ? 'Job complete.' : 'We’re on it.'}<br /><em>{completed ? 'Thank you.' : 'Stay in the loop.'}</em></h1></div><span data-testid="status-booking" className="inline-flex w-fit items-center gap-2 rounded-full bg-accent/25 px-3 py-2 text-xs font-bold text-primary"><span className="size-2 rounded-full bg-primary" />{titleCase(booking.status)}</span></div>
    <section className="overflow-hidden rounded-[24px] border border-border bg-card"><div className="flex flex-col gap-6 bg-primary p-6 text-primary-foreground md:flex-row md:items-center md:justify-between md:p-8"><div className="flex items-center gap-4"><div className="grid size-14 place-items-center rounded-2xl bg-accent text-primary"><UserRound size={24} /></div><div><p className="text-sm text-primary-foreground/60">Your professional</p><h2 className="mt-1 text-xl font-semibold">{booking.technicianName}</h2><p className="mt-1 flex items-center gap-1 text-sm text-accent"><Star size={13} className="fill-accent" /> Verified Melse professional</p></div></div><div className="flex gap-2"><button onClick={() => window.alert(`Calling ${booking.technicianName} is available from your Melse desk.`)} data-testid="button-call-technician" className="grid size-11 place-items-center rounded-full bg-primary-foreground/10 transition hover:bg-primary-foreground/20"><Phone size={17} /></button><button onClick={() => window.alert(`Message ${booking.technicianName} through your Melse desk.`)} data-testid="button-message-technician" className="grid size-11 place-items-center rounded-full bg-primary-foreground/10 transition hover:bg-primary-foreground/20"><MessageCircle size={17} /></button></div></div><div className="p-6 md:p-8"><div className="mb-8 flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{booking.serviceName}</p><p className="mt-1 text-sm font-semibold">{booking.address}</p></div><p className="mono-font text-right text-xs text-primary">{booking.eta}<br /><span className="text-[10px] text-muted-foreground">arrival window</span></p></div><div className="relative"><div className="absolute left-3 top-3 h-1 w-[calc(100%-24px)] rounded-full bg-secondary" /><div className="absolute left-3 top-3 h-1 rounded-full bg-accent transition-all duration-500" style={{ width: `calc(${Math.max(0, Math.min(100, booking.progress))}% - 24px)` }} /><div className="relative flex justify-between">{['Request', 'Assigned', 'On the way', 'In progress', 'Done'].map((label, index) => <div key={label} className="flex w-16 flex-col items-center gap-2 text-center"><span className={`grid size-7 place-items-center rounded-full border-2 text-[11px] font-bold ${index <= Math.round(booking.progress / 25) ? 'border-accent bg-accent text-primary' : 'border-border bg-card text-muted-foreground'}`}>{index < Math.round(booking.progress / 25) ? <Check size={13} /> : index + 1}</span><span className="text-[10px] leading-tight text-muted-foreground">{label}</span></div>)}</div></div></div></section>
    <div className="mt-5 grid gap-5 md:grid-cols-2"><div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-2 text-primary"><Receipt size={17} /><h3 className="font-semibold">Estimate & payment</h3></div><div className="mt-5 flex items-end justify-between"><p className="text-sm text-muted-foreground">Expected range</p><p className="mono-font text-sm font-bold">{money(booking.priceMin)}–{money(booking.priceMax)}</p></div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">You’ll only pay after you confirm the work is done. No surprise fees.</p></div><div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-2 text-primary"><Star size={17} /><h3 className="font-semibold">{completed ? 'How did we do?' : 'Need a hand?'}</h3></div>{completed ? <div className="mt-5 flex items-center gap-2">{[1, 2, 3, 4, 5].map((value) => <button key={value} onClick={() => setRating(value)} data-testid={`button-rating-${value}`} className={`grid size-9 place-items-center rounded-full border transition ${rating >= value ? 'border-accent bg-accent text-primary' : 'border-border text-muted-foreground hover:border-accent'}`}><Star size={16} className={rating >= value ? 'fill-primary' : ''} /></button>)}<button disabled={!rating || update.isPending} onClick={() => update.mutate({ id, data: { status: BookingStatusInputStatus.RATED } }, { onSuccess: (updated) => queryClient.setQueryData(getGetBookingQueryKey(id), updated) })} data-testid="button-submit-rating" className="ml-auto rounded-full bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-35">Submit</button></div> : <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Questions or changes? Your Melse desk is here to help.</p>}</div></div>
    {!completed && nextStatus && <button disabled={update.isPending} onClick={advance} data-testid="button-advance-status" className="mt-6 w-full rounded-2xl border border-primary bg-primary py-4 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 disabled:opacity-40">Demo: move job to {titleCase(nextStatus)} <ArrowRight className="ml-2 inline" size={16} /></button>}
    {update.isError && <p className="mt-3 text-center text-sm text-destructive" data-testid="text-status-error">That update didn’t go through. Try once more.</p>}
  </div>;
}

function TechnicianDashboard() {
  const summary = useGetDashboardSummary();
  const requests = useListServiceRequests();
  const [available, setAvailable] = useState(true);
  const booking = summary.data?.activeBooking;
  return <div className="space-y-9">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Melse partner desk</p><h1 className="mt-3 display-font text-5xl leading-none md:text-6xl">Good morning,<br /><em>let’s get to work.</em></h1></div><button onClick={() => setAvailable(!available)} data-testid="button-toggle-availability" className={`flex w-fit items-center gap-3 rounded-full border px-4 py-3 text-sm font-semibold transition ${available ? 'border-accent bg-accent/20 text-primary' : 'border-border bg-card text-muted-foreground'}`}><span className={`size-2.5 rounded-full ${available ? 'bg-primary' : 'bg-muted-foreground'}`} />{available ? 'Available for jobs' : 'Taking a break'}</button></div>
    <div className="grid gap-4 sm:grid-cols-3"><Metric label="This week" value="ETB 8,460" detail="+12% from last week" icon={TrendingUp} /><Metric label="Jobs completed" value="17" detail="4.2 avg rating" icon={Check} /><Metric label="Your zone" value="Bole + 2" detail="10 active requests" icon={MapPin} /></div>
    <div className="grid gap-7 lg:grid-cols-[1.15fr_.85fr]"><section><div className="mb-5 flex items-center justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Your current job</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">On the ground</h2></div><button onClick={() => window.alert('Job filters are ready for your next dispatch.')} data-testid="button-filter-jobs" className="grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground"><SlidersHorizontal size={16} /></button></div>{booking ? <Link href={`/booking/${booking.id}`} data-testid={`card-technician-job-${booking.id}`} className="block rounded-2xl border border-border bg-primary p-6 text-primary-foreground transition hover:-translate-y-0.5"><div className="flex items-start justify-between"><div><span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">{titleCase(booking.status)}</span><h3 className="mt-5 text-xl font-semibold">{booking.serviceName}</h3><p className="mt-1 text-sm text-primary-foreground/65">{booking.address}</p></div><ArrowRight size={19} /></div><div className="mt-7 grid grid-cols-2 gap-3 border-t border-primary-foreground/15 pt-5"><div><p className="text-xs text-primary-foreground/50">Customer</p><p className="mt-1 text-sm font-semibold">Aster M.</p></div><div><p className="text-xs text-primary-foreground/50">Estimate</p><p className="mono-font mt-1 text-sm font-semibold">{money(booking.priceMin)}–{money(booking.priceMax)}</p></div></div></Link> : <EmptyBlock title="No current job" detail="Stay available and new nearby requests will appear here." />}</section><section><div className="mb-5"><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Queue</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Nearby opportunities</h2></div>{requests.isLoading ? <LoadingBlock lines={3} /> : requests.isError ? <ErrorBlock retry={() => requests.refetch()} /> : requests.data?.length ? <div className="space-y-2">{requests.data.slice(0, 3).map((request) => <div key={request.id} data-testid={`row-opportunity-${request.id}`} className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold">{request.problem}</p><span className="mono-font text-[10px] text-primary">{money(request.priceMin)}+</span></div><p className="mt-2 text-xs text-muted-foreground">{request.address} · {request.urgency}</p></div>)}</div> : <EmptyBlock title="Quiet around here" detail="There are no nearby requests at the moment." />}</section></div>
  </div>;
}

function Metric({ label, value, detail, icon: MetricIcon }: { label: string; value: string; detail: string; icon: LucideIcon }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><MetricIcon size={17} className="text-primary" /></div><p data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="mt-5 display-font text-3xl">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function AdminDashboard() {
  const requests = useListServiceRequests();
  const technicians = useListTechnicians();
  const services = useListServices();
  const [filter, setFilter] = useState<'all' | 'pending' | 'active'>('all');
  const rows = useMemo(() => (requests.data ?? []).filter((request) => filter === 'all' || (filter === 'pending' ? request.urgency === 'Today' : request.urgency !== 'Today')), [requests.data, filter]);
  return <div className="space-y-9">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Melse operations</p><h1 className="mt-3 display-font text-5xl leading-none md:text-6xl">Keep the city<br /><em>moving well.</em></h1></div><div className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-sm"><span className="size-2 rounded-full bg-primary" />System healthy</div></div>
    <div className="grid gap-4 sm:grid-cols-3"><Metric label="Open requests" value={String(requests.data?.length ?? 0)} detail="Across Addis Ababa" icon={CircleAlert} /><Metric label="Available pros" value={String(technicians.data?.filter((tech) => tech.available).length ?? 0)} detail={`${technicians.data?.length ?? 0} verified in network`} icon={Users} /><Metric label="Service lines" value={String(services.data?.length ?? 0)} detail="Active today" icon={Store} /></div>
    <section className="rounded-2xl border border-border bg-card"><div className="flex flex-col justify-between gap-4 border-b border-border p-5 md:flex-row md:items-center"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Dispatch board</p><h2 className="mt-2 text-xl font-semibold">Requests needing a coordinator</h2></div><div className="flex rounded-full bg-secondary p-1">{(['all', 'pending', 'active'] as const).map((item) => <button key={item} onClick={() => setFilter(item)} data-testid={`button-admin-filter-${item}`} className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${filter === item ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}>{item}</button>)}</div></div>{requests.isLoading ? <div className="p-5"><LoadingBlock lines={4} /></div> : requests.isError ? <div className="p-5"><ErrorBlock retry={() => requests.refetch()} /></div> : !rows.length ? <div className="p-5"><EmptyBlock title="Nothing needs your attention" detail="The board is clear for this view." /></div> : <div className="divide-y divide-border">{rows.map((request) => <div key={request.id} data-testid={`row-admin-request-${request.id}`} className="flex flex-col gap-3 p-5 md:flex-row md:items-center"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><IconFor name={request.serviceSlug} size={18} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{request.problem}</p><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${request.urgency === 'Today' ? 'bg-accent/25 text-primary' : 'bg-secondary text-muted-foreground'}`}>{request.urgency || 'Flexible'}</span></div><p className="mt-1 text-sm text-muted-foreground">{request.address} · {shortDate(request.createdAt)}</p></div><div className="flex items-center gap-5 sm:text-right"><div><p className="mono-font text-xs">{money(request.priceMin)}–{money(request.priceMax)}</p><p className="mt-1 text-[10px] text-muted-foreground">{request.arrival}</p></div><Link href={`/technicians/${request.id}`} data-testid={`link-admin-request-${request.id}`} className="grid size-9 place-items-center rounded-full border border-border text-primary transition hover:bg-secondary"><ArrowRight size={16} /></Link></div></div>)}</div>}</section>
    <section><div className="mb-5 flex items-end justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.18em] text-muted-foreground">Network confidence</p><h2 className="mt-2 text-xl font-semibold">Technician signals</h2></div><span className="text-xs text-muted-foreground">Live network view</span></div><div className="grid gap-3 md:grid-cols-2">{technicians.data?.slice(0, 4).map((tech) => <div key={tech.id} data-testid={`card-admin-technician-${tech.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"><div className="grid size-10 place-items-center rounded-xl bg-primary text-xs font-bold text-accent">{tech.initials}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{tech.name}</p><p className="mt-1 text-xs text-muted-foreground">{tech.specialty} · {tech.distance}</p></div><div className="text-right"><p className="flex items-center gap-1 text-sm font-semibold"><Star size={13} className="fill-accent text-accent" />{tech.rating}</p><p className="mt-1 text-[10px] text-muted-foreground">{tech.verified ? 'Verified' : 'Review needed'}</p></div></div>)}</div></section>
  </div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch><Route path="/" component={Home} /><Route path="/request/:serviceSlug" component={RequestFlow} /><Route path="/technicians/:requestId" component={TechnicianPicker} /><Route path="/booking/:id" component={BookingPage} /><Route path="/technician" component={TechnicianDashboard} /><Route path="/admin" component={AdminDashboard} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;