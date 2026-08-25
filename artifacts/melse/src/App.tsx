import { useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Home as HomeIcon,
  ImagePlus,
  LayoutDashboard,
  MapPin,
  Menu,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  ToolCase,
  UserRound,
  Wrench,
  X,
  Zap,
  Refrigerator,
  Droplets,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
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
import type { Booking, Service, Technician } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const money = (value: number) => `ETB ${new Intl.NumberFormat('en-US').format(value)}`;
const dateLabel = (value?: string) => value
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))
  : 'Recently';
const titleCase = (value?: string) => value?.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Pending';

type LaunchService = { slug: string; name: string; description: string; icon: LucideIcon; color: string };
const launchServices: LaunchService[] = [
  { slug: 'appliance-repair', name: 'Appliance Repair', description: 'Fridges, cookers, washers', icon: Refrigerator, color: 'bg-[#f2e9db]' },
  { slug: 'electrician', name: 'Electrician', description: 'Power, lights, sockets', icon: Zap, color: 'bg-[#f8e4c9]' },
  { slug: 'plumber', name: 'Plumbing', description: 'Leaks, drains, fixtures', icon: Droplets, color: 'bg-[#ddebe9]' },
  { slug: 'ac-refrigeration', name: 'AC & Refrigeration', description: 'Cooling that works again', icon: Settings2, color: 'bg-[#e5e5ef]' },
  { slug: 'cleaning', name: 'Cleaning', description: 'A home reset, done well', icon: Sparkles, color: 'bg-[#f0e5e0]' },
];

const issueSets: Record<string, string[]> = {
  'appliance-repair': ['Fridge is not cooling', 'Washing machine problem', 'Cooker or oven issue', 'Something else'],
  electrician: ['Power outage at home', 'Faulty socket or switch', 'Lights flickering', 'Install a light or appliance'],
  plumber: ['Leaking pipe or tap', 'Blocked sink or drain', 'No water or low pressure', 'Install or replace fixture'],
  'ac-refrigeration': ['AC is not cooling', 'Refrigerator is warm', 'Strange noise or leak', 'Service or installation'],
  cleaning: ['Deep clean my home', 'Move-in or move-out clean', 'Kitchen or bathroom clean', 'Regular home cleaning'],
};

function IconFor({ name, size = 20 }: { name?: string; size?: number }) {
  const source = name?.toLowerCase() || '';
  const Icon = source.includes('elect') ? Zap : source.includes('plumb') || source.includes('water') ? Droplets : source.includes('clean') ? Sparkles : source.includes('appliance') ? Refrigerator : Wrench;
  return <Icon size={size} strokeWidth={1.8} />;
}

function LoadingBlock({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-3" data-testid="loading-state">{Array.from({ length: lines }).map((_, index) => <div key={index} className={`shimmer h-16 rounded-xl ${index === 0 ? 'w-3/4' : 'w-full'}`} />)}</div>;
}

function ErrorBlock({ label = 'We could not load this just now.', retry }: { label?: string; retry?: () => void }) {
  return <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5 text-sm text-destructive" data-testid="error-state">
    <div className="flex items-center gap-3"><CircleAlert size={18} /><span>{label}</span></div>
    {retry && <button data-testid="button-retry" onClick={retry} className="mt-3 font-semibold underline underline-offset-4">Try again</button>}
  </div>;
}

function EmptyBlock({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="empty-state">
    <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-secondary text-primary"><PackageCheck size={20} /></div>
    <h3 className="font-semibold">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{detail}</p>{action}
  </div>;
}

function Mark() {
  return <Link href="/" data-testid="link-brand" className="group flex items-center gap-2.5">
    <span className="grid size-9 place-items-center rounded-[11px] bg-accent text-primary shadow-[3px_3px_0_hsl(var(--primary)/.14)]"><span className="relative block size-4 rounded-full border-[3px] border-primary"><span className="absolute -top-2 left-1/2 h-1.5 w-[3px] -translate-x-1/2 rounded-full bg-primary" /><span className="absolute -bottom-2 left-1/2 h-1.5 w-[3px] -translate-x-1/2 rounded-full bg-primary" /></span></span>
    <span className="display-font text-[27px] leading-none tracking-tight">melse</span>
  </Link>;
}

const customerNav = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/jobs', label: 'My Jobs', icon: BriefcaseBusiness },
  { href: '/messages', label: 'Messages', icon: MessageCircle },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isWorkArea = location.startsWith('/technician') || location.startsWith('/admin');
  const activeNav = customerNav.find((item) => item.href === location || (item.href !== '/' && location.startsWith(item.href)));
  return <div className="noise min-h-[100dvh] bg-background text-foreground">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 text-sidebar-foreground md:flex">
      <Mark />
      <div className="mt-12 px-2"><p className="mono-font text-[10px] uppercase tracking-[.17em] text-sidebar-foreground/45">{isWorkArea ? 'Work space' : 'Customer desk'}</p>
        {isWorkArea ? <nav className="mt-4 space-y-1"><Link href="/technician" data-testid="link-nav-technician" className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm ${location.startsWith('/technician') ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent'}`}><ToolCase size={17} />Technician jobs</Link><Link href="/admin" data-testid="link-nav-admin" className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm ${location.startsWith('/admin') ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent'}`}><LayoutDashboard size={17} />Operations</Link><Link href="/" data-testid="link-nav-customer" className="mt-6 flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-sidebar-foreground/65 hover:bg-sidebar-accent"><HomeIcon size={17} />Customer view</Link></nav> :
          <nav className="mt-4 space-y-1">{customerNav.map(({ href, label, icon: NavIcon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${activeNav?.href === href ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}><NavIcon size={17} strokeWidth={1.8} />{label}</Link>)}</nav>}
      </div>
      {!isWorkArea && <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-4"><div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-sidebar-primary" /> A desk you can trust</div><p className="mt-2 text-xs leading-relaxed text-sidebar-foreground/55">Local help, clear estimates, and someone to follow up.</p><div className="mt-4 flex items-center gap-2 text-xs text-sidebar-foreground/55"><MapPin size={13} /> Addis Ababa</div></div>}
      <div className={`${isWorkArea ? 'mt-auto' : 'mt-5'} flex items-center gap-3 border-t border-sidebar-border pt-4`}><div className="grid size-8 place-items-center rounded-full bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground">AM</div><div><p className="text-sm font-semibold">Aster M.</p><p className="text-xs text-sidebar-foreground/50">Addis Ababa</p></div><MoreHorizontal size={16} className="ml-auto text-sidebar-foreground/45" /></div>
    </aside>
    <div className="md:pl-[232px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border/75 bg-background/95 px-4 backdrop-blur-sm md:px-9">
        <div className="md:hidden"><Mark /></div><div className="hidden items-center gap-2 md:flex"><MapPin size={14} className="text-primary" /><span className="text-sm font-medium">Addis Ababa</span><span className="text-xs text-muted-foreground">· local desk</span></div>
        <div className="flex items-center gap-2"><button onClick={() => window.alert('You are all caught up.')} data-testid="button-notifications" className="grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary hover:text-primary"><Bell size={17} /></button><button data-testid="button-mobile-menu" onClick={() => setMenuOpen(!menuOpen)} className="grid size-9 place-items-center rounded-full border border-border bg-card md:hidden">{menuOpen ? <X size={17} /> : <Menu size={17} />}</button></div>
      </header>
      {menuOpen && <div className="absolute right-4 top-[60px] z-30 w-56 rounded-xl border border-border bg-card p-2 shadow-lg md:hidden">{customerNav.map(({ href, label, icon: NavIcon }) => <Link key={href} onClick={() => setMenuOpen(false)} href={href} data-testid={`link-mobile-${label.toLowerCase().replaceAll(' ', '-')}`} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm hover:bg-secondary"><NavIcon size={16} />{label}</Link>)}</div>}
      <main className="page-in mx-auto max-w-[1240px] px-4 pb-28 pt-7 md:px-9 md:pb-10 md:pt-9">{children}</main>
    </div>
    {!isWorkArea && <nav className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-border bg-card/95 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm md:hidden">{customerNav.map(({ href, label, icon: NavIcon }) => <Link key={href} href={href} data-testid={`link-bottom-${label.toLowerCase().replaceAll(' ', '-')}`} className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold ${activeNav?.href === href ? 'text-primary' : 'text-muted-foreground'}`}><NavIcon size={19} strokeWidth={activeNav?.href === href ? 2.2 : 1.8} />{label}</Link>)}</nav>}
  </div>;
}

function ServiceCard({ service, actual }: { service: LaunchService; actual?: Service }) {
  const ServiceIcon = service.icon;
  return <Link href={`/request/${actual?.slug || service.slug}`} data-testid={`card-service-${service.slug}`} className="group flex min-h-[144px] flex-col justify-between border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-[4px_4px_0_hsl(var(--accent))]">
    <div className="flex items-start justify-between"><div className={`grid size-10 place-items-center ${service.color} text-primary`}><ServiceIcon size={20} strokeWidth={1.8} /></div><ArrowRight size={17} className="text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div>
    <div><h3 className="mt-4 text-sm font-bold">{service.name}</h3><p className="mt-1 text-xs text-muted-foreground">{service.description}</p></div>
  </Link>;
}

function Home() {
  const services = useListServices();
  const summary = useGetDashboardSummary();
  const requests = useListServiceRequests();
  const recent = summary.data?.recentRequests ?? requests.data ?? [];
  const actualFor = (slug: string) => services.data?.find((item) => item.slug === slug || item.name.toLowerCase().replaceAll(' ', '-') === slug);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  return <div className="space-y-9">
    <section className="relative overflow-hidden bg-primary px-5 py-7 text-primary-foreground md:px-9 md:py-9">
      <div className="absolute -right-20 -top-28 size-72 rounded-full border-[38px] border-primary-foreground/[.06]" /><div className="absolute bottom-[-100px] right-40 size-48 rounded-full border-[24px] border-accent/20" />
      <div className="relative max-w-2xl"><p className="rise-1 mono-font text-[10px] uppercase tracking-[.18em] text-accent">Good morning, Aster</p><h1 className="rise-2 mt-4 max-w-xl text-[2.7rem] font-bold leading-[.98] tracking-[-.045em] md:text-6xl">What do you need<br /><span className="display-font font-normal italic">help with?</span></h1><p className="rise-3 mt-4 max-w-md text-sm leading-relaxed text-primary-foreground/70">From a dripping tap to a cold fridge, tell us what is happening and we’ll get the right local person moving.</p>
        <button onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })} data-testid="button-start-request" className="rise-3 mt-6 inline-flex min-h-12 items-center gap-2 bg-accent px-5 text-sm font-bold text-accent-foreground transition hover:-translate-y-0.5">Find help <ArrowRight size={17} /></button>
      </div>
    </section>
    <section className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1"><Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" /><input data-testid="input-service-search" type="search" placeholder="Search a home problem" className="h-12 w-full border border-border bg-card pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-accent/30" /></div>
      <button onClick={() => setEmergencyOpen(!emergencyOpen)} data-testid="button-emergency" className={`inline-flex min-h-12 items-center justify-center gap-2 border px-4 text-sm font-bold transition ${emergencyOpen ? 'border-destructive bg-destructive text-destructive-foreground' : 'border-destructive/35 bg-card text-destructive hover:bg-destructive/5'}`}><Zap size={17} /> Need help now?</button>
    </section>
    {emergencyOpen && <div className="flex flex-col gap-4 border border-destructive/25 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="panel-emergency"><div><p className="text-sm font-bold text-destructive">For urgent home issues</p><p className="mt-1 text-xs text-muted-foreground">Choose a service below, then select “Today” so we can prioritize it. Melse does not replace emergency services.</p></div><button onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })} data-testid="button-emergency-choose" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 bg-destructive px-4 text-xs font-bold text-destructive-foreground">Choose a service <ArrowRight size={15} /></button></div>}
    {summary.data?.activeBooking && <ActiveBookingCard booking={summary.data.activeBooking} />}
    <section id="services" className="scroll-mt-24"><div className="mb-4 flex items-end justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">01 / Launch services</p><h2 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">Start with what’s wrong</h2></div><span className="hidden text-xs text-muted-foreground sm:block">Verified local help in Addis</span></div>
      {services.isLoading ? <LoadingBlock lines={2} /> : services.isError ? <ErrorBlock retry={() => services.refetch()} /> : <div className="grid grid-cols-2 gap-2 md:grid-cols-5">{launchServices.map((service) => <ServiceCard key={service.slug} service={service} actual={actualFor(service.slug)} />)}</div>}
    </section>
    <section className="grid gap-8 lg:grid-cols-[1.35fr_.65fr]">
      <div><div className="mb-4 flex items-end justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">02 / Your activity</p><h2 className="mt-2 text-xl font-bold">Recent services</h2></div><Link href="/jobs" data-testid="link-see-all-jobs" className="text-xs font-bold text-primary">See all</Link></div>
        {requests.isLoading && !recent.length ? <LoadingBlock lines={2} /> : requests.isError && !recent.length ? <ErrorBlock retry={() => requests.refetch()} /> : recent.length ? <div className="divide-y divide-border border border-border bg-card">{recent.slice(0, 4).map((request) => <Link href={`/job/${request.id}`} key={request.id} data-testid={`row-request-${request.id}`} className="flex items-center gap-3 p-4 transition hover:bg-secondary/40"><div className="grid size-9 shrink-0 place-items-center bg-secondary text-primary"><IconFor name={request.serviceSlug} size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{request.problem}</p><p className="mt-1 truncate text-xs text-muted-foreground">{request.address} · {dateLabel(request.createdAt)}</p></div><div className="hidden text-right sm:block"><p className="mono-font text-[11px]">{money(request.priceMin)}–{money(request.priceMax)}</p><p className="mt-1 text-[10px] text-muted-foreground">{request.arrival}</p></div><ChevronRight size={16} className="text-muted-foreground" /></Link>)}</div> : <EmptyBlock title="Your service history is clear" detail="When you request help, your recent service will appear here." action={<Link href="#services" data-testid="link-empty-start" className="mt-4 inline-flex text-sm font-bold text-primary">Start a request <ArrowRight size={15} className="ml-1" /></Link>} />}
      </div>
      <div className="border border-border bg-secondary/55 p-5"><div className="flex items-start justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">Why Melse</p><h2 className="mt-2 text-xl font-bold">A safer way to call for help.</h2></div><ShieldCheck size={24} className="text-primary" /></div><div className="mt-6 space-y-4"><TrustLine icon={BadgeCheck} title="Verified people" /><TrustLine icon={FileText} title="Clear ETB estimate" /><TrustLine icon={MessageCircle} title="A desk that follows up" /></div></div>
    </section>
  </div>;
}

function TrustLine({ icon: TrustIcon, title }: { icon: LucideIcon; title: string }) {
  return <div className="flex items-center gap-3 text-sm"><span className="grid size-8 place-items-center bg-card text-primary"><TrustIcon size={16} /></span><span className="font-semibold">{title}</span></div>;
}

function ActiveBookingCard({ booking }: { booking: Booking }) {
  return <Link href={`/booking/${booking.id}`} data-testid={`card-active-booking-${booking.id}`} className="group flex flex-col gap-4 border border-accent/65 bg-accent/15 p-4 transition hover:border-primary sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="relative grid size-11 place-items-center bg-primary text-accent"><Wrench size={20} /><span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-background bg-accent" /></div><div><div className="flex items-center gap-2"><span className="mono-font text-[10px] uppercase tracking-[.14em] text-primary">Active booking</span><span className="size-1 rounded-full bg-primary" /><span className="text-xs text-muted-foreground">{titleCase(booking.status)}</span></div><h3 className="mt-1 text-sm font-bold">{booking.serviceName} with {booking.technicianName}</h3><p className="mt-1 text-xs text-muted-foreground">{booking.eta} · {booking.address}</p></div></div><div className="flex items-center justify-between gap-4 sm:justify-end"><div className="sm:text-right"><p className="mono-font text-xs">{money(booking.priceMin)}–{money(booking.priceMax)}</p><div className="mt-2 h-1.5 w-28 overflow-hidden bg-primary/15"><div className="h-full bg-primary" style={{ width: `${booking.progress}%` }} /></div></div><ArrowRight size={17} className="text-primary transition-transform group-hover:translate-x-1" /></div></Link>;
}

function RequestFlow() {
  const { serviceSlug = '' } = useParams<{ serviceSlug: string }>();
  const services = useListServices();
  const create = useCreateServiceRequest();
  const [, setLocation] = useLocation();
  const normalizedServiceSlug = serviceSlug === 'electrical' ? 'electrician' : serviceSlug === 'plumbing' ? 'plumber' : serviceSlug;
  const [step, setStep] = useState(1);
  const [problem, setProblem] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [urgency, setUrgency] = useState('Today');
  const [photoName, setPhotoName] = useState('');
  const service = launchServices.find((item) => item.slug === normalizedServiceSlug);
  const actual = services.data?.find((item) => item.slug === normalizedServiceSlug);
  const issues = issueSets[normalizedServiceSlug] ?? ['Tell us what needs attention', 'Repair or replacement', 'Installation', 'Something else'];
  const canNext = step === 1 ? Boolean(problem) : step === 2 ? description.trim().length > 5 : Boolean(address.trim());
  const submit = () => create.mutate({ data: { serviceSlug: actual?.slug || normalizedServiceSlug, problem, description, address, urgency } }, { onSuccess: (request) => setLocation(`/technicians/${request.id}`) });
  return <div className="mx-auto max-w-3xl">
    <Link href="/" data-testid="link-back-home" className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /> Back</Link>
    <div className="mb-7"><div className="flex gap-2">{[1, 2, 3].map((number) => <span key={number} className={`h-1.5 flex-1 ${number <= step ? 'bg-primary' : 'bg-border'}`} />)}</div><div className="mt-4 flex items-center justify-between"><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">Request help · 0{step} of 03</p><span className="text-xs font-semibold text-muted-foreground">{service?.name || 'Home service'}</span></div><h1 className="mt-3 text-4xl font-bold leading-[.98] tracking-[-.04em] md:text-5xl">{step === 1 ? 'What is going on?' : step === 2 ? 'Give us the useful detail.' : 'Where should we come?'}</h1></div>
    {services.isLoading ? <LoadingBlock lines={3} /> : services.isError ? <ErrorBlock retry={() => services.refetch()} /> : <div className="border border-border bg-card p-4 md:p-7">
      {step === 1 && <div><p className="mb-4 text-sm text-muted-foreground">Choose the closest match. You can explain more next.</p><div className="grid gap-2 sm:grid-cols-2">{issues.map((issue) => <button key={issue} onClick={() => setProblem(issue)} data-testid={`button-problem-${issue.toLowerCase().replaceAll(' ', '-')}`} className={`flex min-h-14 items-center justify-between border p-4 text-left text-sm font-semibold transition ${problem === issue ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/60 hover:bg-secondary'}`}><span>{issue}</span>{problem === issue ? <Check size={17} /> : <PlusMark />}</button>)}</div></div>}
      {step === 2 && <div><label htmlFor="request-description" className="text-sm font-bold">What should the professional know?</label><p className="mt-1 text-sm text-muted-foreground">A few words help us send the right person first time.</p><textarea id="request-description" data-testid="input-request-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="For example: water is dripping under the kitchen sink..." className="mt-5 min-h-40 w-full resize-none border border-input bg-background p-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-accent/30" /><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><label className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 border border-border px-3 text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"><ImagePlus size={16} /> {photoName ? 'Photo selected' : 'Add a photo (optional)'}<input type="file" accept="image/*" className="sr-only" data-testid="input-request-photo" onChange={(event) => setPhotoName(event.target.files?.[0]?.name || '')} /></label><span className="text-xs text-muted-foreground">{photoName ? `${photoName} · held for this request` : `${description.length} characters`}</span></div></div>}
      {step === 3 && <div className="space-y-6"><div><label htmlFor="request-address" className="text-sm font-bold">Your Addis Ababa address</label><p className="mt-1 text-sm text-muted-foreground">A house, building, or area is enough to start.</p><div className="relative mt-3"><MapPin size={17} className="absolute left-4 top-4 text-primary" /><input id="request-address" data-testid="input-request-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Bole, Kazanchis, CMC..." className="h-14 w-full border border-input bg-background pl-11 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-accent/30" /></div></div><div><p className="text-sm font-bold">When do you need it?</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{['Today', 'This week', 'Just planning'].map((item) => <button key={item} onClick={() => setUrgency(item)} data-testid={`button-urgency-${item.toLowerCase().replaceAll(' ', '-')}`} className={`min-h-16 border px-3 py-3 text-left text-sm transition ${urgency === item ? 'border-primary bg-secondary font-bold text-primary' : 'border-border hover:border-primary/50'}`}><Clock3 size={16} className="mb-2" />{item}</button>)}</div></div><div className="flex gap-3 bg-secondary/60 p-4 text-sm text-muted-foreground"><ShieldCheck className="shrink-0 text-primary" size={18} /><p>Before booking, you’ll see an estimate of <strong className="text-foreground">ETB 400–700</strong> and an arrival window.</p></div></div>}
      <div className="mt-7 flex items-center justify-between border-t border-border pt-5"><button data-testid="button-request-back" onClick={() => setStep(Math.max(1, step - 1))} className={`text-sm font-bold ${step === 1 ? 'invisible' : ''}`}>Back</button>{step < 3 ? <button disabled={!canNext} data-testid="button-request-next" onClick={() => setStep(step + 1)} className="inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-35">Continue <ChevronRight size={17} /></button> : <button disabled={!canNext || create.isPending} data-testid="button-submit-request" onClick={submit} className="inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-35">{create.isPending ? 'Sending request...' : 'See estimate and people'} <ArrowRight size={17} /></button>}</div>
      {create.isError && <p className="mt-4 text-right text-sm text-destructive" data-testid="text-request-error">We could not send that. Please try again.</p>}
    </div>}
  </div>;
}

function PlusMark() {
  return <span className="text-lg font-normal text-muted-foreground">+</span>;
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
    <Link href="/" data-testid="link-technicians-back" className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /> Home</Link>
    <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">04 / Your estimate</p><h1 className="mt-3 text-4xl font-bold leading-none tracking-[-.04em] md:text-5xl">Choose someone<br /><span className="display-font font-normal italic">you feel good about.</span></h1></div><div className="border border-accent/60 bg-accent/15 px-4 py-3"><p className="text-xs text-muted-foreground">Estimated range</p><p data-testid="text-request-estimate" className="mt-1 text-lg font-bold text-primary">{request ? `${money(request.priceMin)}–${money(request.priceMax)}` : 'ETB 400–700'}</p><p className="mt-1 text-xs text-muted-foreground">{request?.arrival || 'Arrival window shown below'}</p></div></div>
    <div className="mb-5 flex items-start gap-3 border border-border bg-card p-4 text-sm"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" /><div><p className="font-bold">Verified professionals near you</p><p className="mt-1 text-xs text-muted-foreground">Pick a person to review the booking. No payment is taken here.</p></div></div>
    {technicians.isLoading ? <LoadingBlock lines={3} /> : technicians.isError ? <ErrorBlock retry={() => technicians.refetch()} /> : !available.length ? <EmptyBlock title="No one is available right now" detail="Try again in a little while and we’ll look across Addis." /> : <><div className="space-y-2">{available.map((tech) => <TechnicianRow key={tech.id} tech={tech} selected={selected === tech.id} onSelect={() => setSelected(tech.id)} />)}</div><div className="sticky bottom-16 mt-6 flex items-center justify-between gap-4 border border-border bg-card p-4 shadow-lg md:bottom-4"><p className="hidden text-sm text-muted-foreground sm:block">{selected ? 'Review your choice, then confirm.' : 'Choose a professional to continue.'}</p><button disabled={!selected || create.isPending} onClick={book} data-testid="button-book-technician" className="ml-auto inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-35">{create.isPending ? 'Booking...' : 'Confirm this professional'} <ArrowRight size={16} /></button></div>{create.isError && <p className="mt-3 text-right text-sm text-destructive" data-testid="text-booking-error">We could not make that booking. Please try again.</p>}</>}
  </div>;
}

function TechnicianRow({ tech, selected, onSelect }: { tech: Technician; selected: boolean; onSelect: () => void }) {
  return <button onClick={onSelect} data-testid={`card-technician-${tech.id}`} className={`flex w-full items-center gap-3 border p-4 text-left transition md:p-5 ${selected ? 'border-primary bg-secondary shadow-[3px_3px_0_hsl(var(--accent))]' : 'border-border bg-card hover:border-primary/50'}`}><div className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-accent">{tech.initials}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{tech.name}</h3>{tech.verified && <span className="inline-flex items-center gap-1 bg-accent/25 px-2 py-1 text-[10px] font-bold text-primary"><BadgeCheck size={12} /> Verified</span>}</div><p className="mt-1 text-sm text-muted-foreground">{tech.specialty}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1 text-foreground"><Star size={13} className="fill-accent text-accent" /> {tech.rating} <span className="text-muted-foreground">({tech.reviews})</span></span><span>{tech.distance} away</span><span>Arrives {tech.eta}</span></div></div><div className="hidden text-right sm:block"><p className="mono-font text-xs text-primary">{tech.earnings}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">typical visit</p></div>{selected && <div className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"><Check size={15} /></div>}</button>;
}

const statusOrder: Array<'REQUESTED' | 'SEARCHING' | 'ASSIGNED' | 'ACCEPTED' | 'TECHNICIAN_EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CUSTOMER_CONFIRMED' | 'PAID' | 'RATED'> = [BookingStatusInputStatus.REQUESTED, BookingStatusInputStatus.SEARCHING, BookingStatusInputStatus.ASSIGNED, BookingStatusInputStatus.ACCEPTED, BookingStatusInputStatus.TECHNICIAN_EN_ROUTE, BookingStatusInputStatus.ARRIVED, BookingStatusInputStatus.IN_PROGRESS, BookingStatusInputStatus.COMPLETED, BookingStatusInputStatus.CUSTOMER_CONFIRMED, BookingStatusInputStatus.PAID, BookingStatusInputStatus.RATED];

function BookingPage() {
  const { id = '' } = useParams<{ id: string }>();
  const bookingQuery = useGetBooking(id, { query: { enabled: Boolean(id), queryKey: getGetBookingQueryKey(id) } });
  const update = useUpdateBookingStatus();
  const client = useQueryClient();
  const booking = bookingQuery.data;
  if (bookingQuery.isLoading) return <div className="mx-auto max-w-3xl"><LoadingBlock lines={5} /></div>;
  if (bookingQuery.isError || !booking) return <div className="mx-auto max-w-3xl"><ErrorBlock label="We could not find this booking." retry={() => bookingQuery.refetch()} /></div>;
  const currentIndex = statusOrder.indexOf(booking.status as typeof statusOrder[number]);
  const nextStatus = currentIndex >= 0 ? statusOrder[Math.min(currentIndex + 1, statusOrder.length - 1)] : undefined;
  const completed = ['COMPLETED', 'CUSTOMER_CONFIRMED', 'PAID', 'RATED'].includes(booking.status);
  const advance = () => nextStatus && update.mutate({ id, data: { status: nextStatus } }, { onSuccess: (updated) => client.setQueryData(getGetBookingQueryKey(id), updated) });
  return <div className="mx-auto max-w-4xl"><Link href="/" data-testid="link-booking-home" className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /> Home</Link><div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">Booking #{booking.id.slice(-6)}</p><h1 className="mt-3 text-4xl font-bold leading-none tracking-[-.04em] md:text-5xl">{completed ? 'Job complete.' : 'We’re on it.'}<br /><span className="display-font font-normal italic">{completed ? 'Thank you.' : 'Stay in the loop.'}</span></h1></div><span data-testid="status-booking" className="inline-flex w-fit items-center gap-2 bg-accent/25 px-3 py-2 text-xs font-bold text-primary"><span className="size-2 rounded-full bg-primary" />{titleCase(booking.status)}</span></div><div className="grid gap-5 lg:grid-cols-[1fr_320px]"><section className="border border-border bg-card p-5 md:p-7"><div className="flex items-start justify-between border-b border-border pb-5"><div><p className="text-sm font-bold">{booking.serviceName}</p><p className="mt-1 text-sm text-muted-foreground">with {booking.technicianName}</p></div><div className="text-right"><p className="mono-font text-sm">{money(booking.priceMin)}–{money(booking.priceMax)}</p><p className="mt-1 text-xs text-muted-foreground">estimate</p></div></div><StatusTimeline currentIndex={currentIndex} /><div className="mt-6 flex items-start gap-3 bg-secondary/60 p-4 text-sm"><MapPin size={17} className="mt-0.5 shrink-0 text-primary" /><div><p className="font-bold">{booking.address}</p><p className="mt-1 text-xs text-muted-foreground">Arrival: {booking.eta}</p></div></div>{!completed && <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Next update comes from the service desk.</p><button disabled={!nextStatus || update.isPending} onClick={advance} data-testid="button-demo-advance-status" className="min-h-10 border border-primary px-4 text-xs font-bold text-primary disabled:opacity-40">Demo: advance status</button></div>}{update.isError && <p className="mt-3 text-sm text-destructive" data-testid="text-status-error">Status could not be updated.</p>}</section><aside className="space-y-3"><div className="border border-border bg-secondary/55 p-5"><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">What to expect</p><p className="mt-3 text-sm leading-relaxed">Your estimate is a range, not a payment. Confirm the final amount with the professional before work begins.</p></div><Link href="/support" data-testid="link-booking-support" className="flex min-h-12 items-center justify-between border border-border bg-card px-4 text-sm font-bold transition hover:border-primary">Need support? <ArrowRight size={16} className="text-primary" /></Link></aside></div></div>;
}

function StatusTimeline({ currentIndex }: { currentIndex: number }) {
  const stages = ['Request received', 'Professional selected', 'On the way', 'Work in progress', 'Complete'];
  const stageIndexes = [0, 3, 4, 6, 7];
  return <div className="mt-7 space-y-0">{stages.map((stage, index) => { const done = currentIndex >= stageIndexes[index]; const current = index === stages.length - 1 ? currentIndex >= stageIndexes[index] : currentIndex < stageIndexes[index] && currentIndex >= (stageIndexes[index - 1] ?? 0); return <div key={stage} className="flex gap-3"><div className="flex flex-col items-center"><span className={`grid size-7 place-items-center rounded-full border ${done ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>{done ? <Check size={14} /> : <span className="size-1.5 rounded-full bg-current" />}</span>{index < stages.length - 1 && <span className={`my-1 h-8 w-px ${done ? 'bg-primary' : 'bg-border'}`} />}</div><div className="pb-4 pt-1"><p className={`text-sm ${done || current ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{stage}</p>{current && <p className="mt-1 text-xs text-primary">Current stage</p>}</div></div>; })}</div>;
}

function Jobs() {
  const requests = useListServiceRequests();
  const summary = useGetDashboardSummary();
  const rows = requests.data ?? [];
  return <PageIntro eyebrow="Customer desk" title="My jobs" detail="A simple record of every request you have made with Melse." action={<Link href="/" data-testid="link-jobs-new" className="inline-flex min-h-11 items-center gap-2 bg-primary px-4 text-sm font-bold text-primary-foreground">New request <ArrowRight size={16} /></Link>}><div className="space-y-5">{summary.data?.activeBooking && <ActiveBookingCard booking={summary.data.activeBooking} />}{requests.isLoading ? <LoadingBlock lines={4} /> : requests.isError ? <ErrorBlock retry={() => requests.refetch()} /> : rows.length ? <div className="divide-y divide-border border border-border bg-card">{rows.map((request) => <Link href={`/job/${request.id}`} key={request.id} data-testid={`row-job-${request.id}`} className="flex items-center gap-3 p-4 hover:bg-secondary/40"><div className="grid size-10 place-items-center bg-secondary text-primary"><IconFor name={request.serviceSlug} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{request.problem}</p><p className="mt-1 text-xs text-muted-foreground">{request.address} · {dateLabel(request.createdAt)}</p></div><div className="hidden text-right sm:block"><p className="mono-font text-xs">{money(request.priceMin)}–{money(request.priceMax)}</p><p className="mt-1 text-[10px] text-muted-foreground">{request.arrival}</p></div><ChevronRight size={16} className="text-muted-foreground" /></Link>)}</div> : <EmptyBlock title="No jobs yet" detail="Start with a service and we’ll keep the details here." action={<Link href="/" data-testid="link-jobs-empty-start" className="mt-4 inline-flex text-sm font-bold text-primary">Find help <ArrowRight size={15} className="ml-1" /></Link>} />}</div></PageIntro>;
}

function RequestDetails() {
  const { id = '' } = useParams<{ id: string }>();
  const requests = useListServiceRequests();
  const request = requests.data?.find((item) => item.id === id);
  if (requests.isLoading) return <LoadingBlock lines={4} />;
  if (requests.isError) return <ErrorBlock retry={() => requests.refetch()} />;
  if (!request) return <EmptyBlock title="Request not found" detail="This service request may no longer be available." action={<Link href="/jobs" data-testid="link-details-jobs" className="mt-4 inline-flex text-sm font-bold text-primary">Back to jobs</Link>} />;
  return <div className="mx-auto max-w-3xl"><Link href="/jobs" data-testid="link-details-back" className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"><ChevronLeft size={16} /> My jobs</Link><div className="mb-6"><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">Request · {dateLabel(request.createdAt)}</p><h1 className="mt-3 text-4xl font-bold tracking-[-.04em]">{request.problem}</h1><p className="mt-2 text-sm text-muted-foreground">{request.address}</p></div><div className="space-y-3"><DetailLine label="Service" value={request.serviceSlug} /><DetailLine label="What you told us" value={request.description} /><DetailLine label="Estimate" value={`${money(request.priceMin)}–${money(request.priceMax)}`} /><DetailLine label="Arrival" value={request.arrival} /></div><Link href={`/technicians/${request.id}`} data-testid="link-request-continue" className="mt-6 inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground">See available professionals <ArrowRight size={16} /></Link></div>;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="border border-border bg-card p-4"><p className="mono-font text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div>;
}

function Messages() {
  return <PageIntro eyebrow="Customer desk" title="Messages" detail="Updates from your Melse service desk will appear here."><EmptyBlock title="No messages yet" detail="When your request needs an update, we’ll keep the conversation in one place." action={<Link href="/support" data-testid="link-messages-support" className="mt-4 inline-flex text-sm font-bold text-primary">Contact support <ArrowRight size={15} className="ml-1" /></Link>} /></PageIntro>;
}

function Profile() {
  return <PageIntro eyebrow="Customer desk" title="Profile" detail="Keep your contact details and service preferences close at hand."><div className="max-w-xl border border-border bg-card"><div className="flex items-center gap-4 border-b border-border p-5"><div className="grid size-14 place-items-center rounded-full bg-primary text-sm font-bold text-accent">AM</div><div><p className="font-bold">Aster Mekonnen</p><p className="mt-1 text-sm text-muted-foreground">Customer in Addis Ababa</p></div></div><div className="divide-y divide-border"><DetailLine label="Phone" value="+251 9•• ••• •••" /><DetailLine label="Saved area" value="Addis Ababa" /><Link href="/support" data-testid="link-profile-support" className="flex items-center justify-between p-4 text-sm font-bold hover:bg-secondary/40">Support and guarantees <ArrowRight size={16} className="text-primary" /></Link></div></div></PageIntro>;
}

function Support() {
  return <PageIntro eyebrow="Melse support" title="How can we help?" detail="A real person from the desk can help with a request, estimate, or guarantee question."><div className="grid max-w-2xl gap-3 md:grid-cols-2"><SupportItem icon={MessageCircle} title="Message the desk" detail="Ask about an active request or booking." /><SupportItem icon={ShieldCheck} title="Guarantee and payment" detail="Your estimate is a range. Confirm the final amount before work begins." /><SupportItem icon={CircleAlert} title="Urgent home issue" detail="For immediate danger, contact local emergency services first." /><SupportItem icon={FileText} title="Request a review" detail="We can help document an issue after a visit." /></div><Link href="/" data-testid="link-support-home" className="mt-6 inline-flex min-h-11 items-center gap-2 border border-primary px-5 text-sm font-bold text-primary">Back to home <ArrowRight size={16} /></Link></PageIntro>;
}

function SupportItem({ icon: SupportIcon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return <div className="border border-border bg-card p-5"><SupportIcon size={19} className="text-primary" /><h2 className="mt-4 text-sm font-bold">{title}</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>;
}

function PageIntro({ eyebrow, title, detail, action, children }: { eyebrow: string; title: string; detail: string; action?: ReactNode; children: ReactNode }) {
  return <div className="mx-auto max-w-4xl"><div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">{eyebrow}</p><h1 className="mt-3 text-4xl font-bold tracking-[-.04em] md:text-5xl">{title}</h1><p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{detail}</p></div>{action}</div>{children}</div>;
}

function TechnicianDashboard() {
  const requests = useListServiceRequests();
  const technicians = useListTechnicians();
  return <PageIntro eyebrow="Technician workspace" title="Today’s jobs" detail="A focused queue for local professionals. Demo status controls remain clearly marked." action={<Link href="/" data-testid="link-technician-customer" className="inline-flex min-h-10 items-center gap-2 border border-primary px-4 text-xs font-bold text-primary">Customer view <ArrowRight size={15} /></Link>}><div className="mb-5 grid gap-3 sm:grid-cols-3"><Metric label="Open requests" value={String(requests.data?.length ?? '—')} /><Metric label="Available crew" value={String(technicians.data?.filter((tech) => tech.available).length ?? '—')} /><Metric label="Area" value="Addis" /></div>{requests.isLoading ? <LoadingBlock lines={4} /> : requests.isError ? <ErrorBlock retry={() => requests.refetch()} /> : requests.data?.length ? <div className="divide-y divide-border border border-border bg-card">{requests.data.map((request) => <div key={request.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="grid size-9 place-items-center bg-secondary text-primary"><IconFor name={request.serviceSlug} size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{request.problem}</p><p className="mt-1 text-xs text-muted-foreground">{request.address} · {request.urgency || 'Flexible'}</p></div><span className="bg-secondary px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground">New request</span></div>)}</div> : <EmptyBlock title="No requests in the queue" detail="New local requests will appear here." />}</PageIntro>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border border-border bg-card p-4"><p className="mono-font text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold text-primary">{value}</p></div>;
}

function AdminDashboard() {
  const summary = useGetDashboardSummary();
  const requests = useListServiceRequests();
  const technicians = useListTechnicians();
  const rows = requests.data ?? [];
  return <PageIntro eyebrow="Operations workspace" title="Service desk" detail="Coordinate requests, availability, and follow-up across Addis Ababa." action={<Link href="/" data-testid="link-admin-customer" className="inline-flex min-h-10 items-center gap-2 border border-primary px-4 text-xs font-bold text-primary">Customer view <ArrowRight size={15} /></Link>}><div className="mb-7 grid gap-3 sm:grid-cols-3"><Metric label="Requests" value={String(rows.length || '—')} /><Metric label="Technicians" value={String(technicians.data?.length || '—')} /><Metric label="Active booking" value={summary.data?.activeBooking ? '1 live' : 'None'} /></div><div className="border border-border bg-card"><div className="flex items-center justify-between border-b border-border p-4"><div><p className="mono-font text-[10px] uppercase tracking-[.14em] text-muted-foreground">Queue</p><h2 className="mt-1 font-bold">Requests needing a desk</h2></div><span className="text-xs text-muted-foreground">Live API view</span></div>{requests.isLoading ? <div className="p-4"><LoadingBlock lines={3} /></div> : requests.isError ? <div className="p-4"><ErrorBlock retry={() => requests.refetch()} /></div> : rows.length ? rows.map((request) => <div key={request.id} className="flex flex-col gap-3 border-b border-border p-4 last:border-0 md:flex-row md:items-center"><div className="min-w-0 flex-1"><p className="font-bold">{request.problem}</p><p className="mt-1 text-xs text-muted-foreground">{request.address} · {dateLabel(request.createdAt)}</p></div><div className="flex items-center gap-3"><span className="bg-accent/20 px-2 py-1 text-[10px] font-bold text-primary">{request.urgency || 'Flexible'}</span><Link href={`/technicians/${request.id}`} data-testid={`link-admin-request-${request.id}`} className="grid size-9 place-items-center border border-border text-primary"><ArrowRight size={16} /></Link></div></div>) : <div className="p-4"><EmptyBlock title="Queue is clear" detail="No customer requests need attention right now." /></div>}</div></PageIntro>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch><Route path="/" component={Home} /><Route path="/jobs" component={Jobs} /><Route path="/my-jobs" component={Jobs} /><Route path="/messages" component={Messages} /><Route path="/profile" component={Profile} /><Route path="/support" component={Support} /><Route path="/request/:serviceSlug" component={RequestFlow} /><Route path="/technicians/:requestId" component={TechnicianPicker} /><Route path="/job/:id" component={RequestDetails} /><Route path="/jobs/:id" component={RequestDetails} /><Route path="/booking/:id" component={BookingPage} /><Route path="/technician" component={TechnicianDashboard} /><Route path="/admin" component={AdminDashboard} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;