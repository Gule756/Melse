import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  BriefcaseBusiness,
  Car,
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
  Sun,
  Moon,
  Languages,
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
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

type Language = 'en' | 'am';
type Theme = 'light' | 'dark';
const languageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({ language: 'en', setLanguage: () => undefined });
const themeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({ theme: 'light', setTheme: () => undefined });
type MarketplaceMode = 'customer' | 'provider' | 'admin';
type SessionUser = { id: string; fullName: string; phoneNumber: string; roles: string[]; activeMode: Uppercase<MarketplaceMode> };
const authContext = createContext<{ user: SessionUser; updateUser: (user: SessionUser) => void } | null>(null);

function useAuth() {
  const value = useContext(authContext);
  if (!value) throw new Error('Authentication context is unavailable.');
  return value;
}

const translations: Record<string, string> = {
  'Home': 'መነሻ', 'My Jobs': 'ስራዎቼ', 'Messages': 'መልዕክቶች', 'Profile': 'መገለጫ',
  'Good morning, Aster': 'እንደምን አደርክ፣ አስቴር', 'What do you need': 'ምን እርዳታ ያስፈልግዎታል', 'help with?': 'ምን እንርዳዎ?',
  'Search for a service': 'አገልግሎት ይፈልጉ', 'Need help now?': 'አሁን እርዳታ ይፈልጋሉ?', 'Get Help Now': 'አሁን እርዳታ ያግኙ',
  'What can we help with?': 'በምን እንርዳዎ?', 'See all services': 'ሁሉንም አገልግሎቶች ይመልከቱ', 'Recent services': 'የቅርብ ጊዜ አገልግሎቶች',
  'Why Melse': 'ለምን መልሴ?', 'Verified people': 'የተረጋገጡ ባለሙያዎች', 'Clear ETB estimate': 'ግልጽ የETB ግምት',
  'A desk that follows up': 'የሚከታተል የእርዳታ ቡድን', 'Customer desk': 'የደንበኛ ጠረጴዛ', 'Addis Ababa': 'አዲስ አበባ',
  'Service directory': 'የአገልግሎት ዝርዝር', 'Everything we fix': 'የምንጠግናቸው ነገሮች ሁሉ', 'Browse the broader Melse network for home, repair, and essential services.': 'የቤት፣ የጥገና እና አስፈላጊ አገልግሎቶችን ይመልከቱ።',
  'Request help': 'እርዳታ ይጠይቁ', 'of': 'ከ', 'Home service': 'የቤት አገልግሎት', 'Back': 'ተመለስ', 'held for this request': 'ለዚህ ጥያቄ ተይዟል', 'characters': 'ቁምፊዎች', 'What is going on?': 'ምን ችግር ተፈጥሯል?', 'Give us the useful detail.': 'ጠቃሚ ዝርዝሩን ይንገሩን።', 'Where should we come?': 'የት እንምጣ?',
  'Choose the closest match. You can explain more next.': 'በጣም የሚቀርበውን ችግር ይምረጡ። በሚቀጥለው ደረጃ ተጨማሪ ማብራሪያ መስጠት ይችላሉ።', 'What should the professional know?': 'ባለሙያው ምን ማወቅ አለበት?', 'A few words help us send the right person first time.': 'ጥቂት ቃላት ትክክለኛውን ባለሙያ እንድንልክ ይረዱናል።', 'For example: water is dripping under the kitchen sink...': 'ለምሳሌ፦ ከኩሽናው ማጠቢያ ስር ውሃ እየፈሰሰ ነው...', 'Add a photo (optional)': 'ፎቶ ያክሉ (አማራጭ)', 'Photo selected': 'ፎቶ ተመርጧል',
  'Your Addis Ababa address': 'የአዲስ አበባ አድራሻዎ', 'A house, building, or area is enough to start.': 'ለመጀመር የቤት፣ የህንፃ ወይም የአካባቢ ስም በቂ ነው።', 'When do you need it?': 'መቼ ያስፈልግዎታል?', 'Today': 'ዛሬ', 'This week': 'በዚህ ሳምንት', 'Just planning': 'እያቀዱ ብቻ', 'Before booking, you’ll see an estimate of': 'ቦታ ከማስያዝዎ በፊት የዋጋ ግምት ያያሉ።', 'and an arrival window.': 'እና የመድረሻ ጊዜ ያያሉ።', 'Continue': 'ቀጥል', 'Sending request...': 'ጥያቄው እየተላከ ነው...', 'See estimate and people': 'ግምቱንና ባለሙያዎቹን ይመልከቱ', 'Tell us what needs attention': 'ምን እንደሚስተካከል ይንገሩን', 'Repair or replacement': 'ጥገና ወይም መተካት', 'Installation': 'ተከላ', 'Something else': 'ሌላ ነገር',
  'Fridge is not cooling': 'ማቀዝቀዣው አያቀዘቅዝም', 'Washing machine problem': 'የልብስ ማጠቢያ ችግር', 'Cooker or oven issue': 'የማብሰያ ወይም የምድጃ ችግር', 'Power outage at home': 'በቤት ውስጥ የኤሌክትሪክ መቋረጥ', 'Faulty socket or switch': 'የተበላሸ ሶኬት ወይም ማብሪያ', 'Lights flickering': 'መብራቶች ይንጠባጠባሉ', 'Install a light or appliance': 'መብራት ወይም የቤት ዕቃ መትከል',
  'Leaking pipe or tap': 'የሚያፈስ ቧንቧ ወይም ቆጣሪ', 'Blocked sink or drain': 'የተዘጋ ማጠቢያ ወይም መውረጃ', 'No water or low pressure': 'ውሃ የለም ወይም ግፊቱ ዝቅተኛ ነው', 'Install or replace fixture': 'ዕቃ መትከል ወይም መተካት', 'AC is not cooling': 'ኤሲው አያቀዘቅዝም', 'Refrigerator is warm': 'ማቀዝቀዣው ሞቃት ነው', 'Strange noise or leak': 'እንግዳ ድምፅ ወይም ፍሳሽ', 'Service or installation': 'ጥገና ወይም ተከላ', 'Deep clean my home': 'ቤቴን በጥልቀት ማጽዳት', 'Move-in or move-out clean': 'ሲገቡ ወይም ሲወጡ ጽዳት', 'Kitchen or bathroom clean': 'የኩሽና ወይም የመታጠቢያ ቤት ጽዳት', 'Regular home cleaning': 'መደበኛ የቤት ጽዳት',
  'Launch services': 'ዋና አገልግሎቶች', 'Your activity': 'የእርስዎ እንቅስቃሴ', 'Verified local help in Addis': 'በአዲስ አበባ የተረጋገጠ የአካባቢ እርዳታ',
  'See all': 'ሁሉንም ይመልከቱ', 'A safer way to call for help.': 'እርዳታ ለመጠየቅ የተሻለ እና ደህንነቱ የተጠበቀ መንገድ።',
  'Find help': 'እርዳታ ያግኙ', 'Get a verified technician as soon as possible.': 'የተረጋገጠ ባለሙያ በተቻለ ፍጥነት ያግኙ።',
  'Appliance Repair': 'የቤት ዕቃ ጥገና', 'Electrician': 'ኤሌክትሪሺያን', 'Plumbing': 'የውሃ ቧንቧ',
  'AC & Refrigeration': 'ኤሲ እና ማቀዝቀዣ', 'Cleaning': 'ጽዳት', 'Fridges, cookers, washers': 'ማቀዝቀዣ፣ ማብሰያ እና የልብስ ማጠቢያ',
  'Power, lights, sockets': 'ኤሌክትሪክ፣ መብራት እና ሶኬት', 'Leaks, drains, fixtures': 'ፍሳሽ፣ የውሃ መውረጃ እና ዕቃዎች',
  'Cooling that works again': 'እንደገና የሚሰራ ማቀዝቀዣ', 'A home reset, done well': 'ቤትዎን በጥራት ማጽዳት',
  'Your service history is clear': 'የአገልግሎት ታሪክዎ ባዶ ነው', 'When you request help, your recent service will appear here.': 'እርዳታ ሲጠይቁ የቅርብ ጊዜ አገልግሎትዎ እዚህ ይታያል።', 'Start a request': 'ጥያቄ ይጀምሩ',
  'We could not load this just now.': 'አሁን መጫን አልቻልንም።', 'Try again': 'እንደገና ይሞክሩ', 'No jobs yet': 'እስካሁን ስራ የለም',
  'Start with a service and we’ll keep the details here.': 'አገልግሎት ይምረጡ እና ዝርዝሩን እዚህ እናስቀምጣለን።', 'Request not found': 'ጥያቄው አልተገኘም',
  'This service request may no longer be available.': 'ይህ የአገልግሎት ጥያቄ ከእንግዲህ ላይገኝ ይችላል።', 'Back to jobs': 'ወደ ስራዎች ይመለሱ',
  'No messages yet': 'እስካሁን መልዕክት የለም', 'Contact support': 'ድጋፍን ያግኙ', 'No one is available right now': 'አሁን ማንም አይገኝም',
};
const useLanguage = () => useContext(languageContext);
const useTheme = () => useContext(themeContext);
const localized = (value: string, language: Language) => language === 'am' ? translations[value] ?? value : value;

const money = (value: number) => `ETB ${new Intl.NumberFormat('en-US').format(value)}`;
const dateLabel = (value?: string) => value
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))
  : 'Recently';
const titleCase = (value?: string) => value?.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Pending';

type LaunchService = { slug: string; name: string; description: string; icon: LucideIcon; color: string };

const normalizeSearchText = (value: string) => value
  .toLowerCase()
  .trim()
  .replace(/[_/\-]+/g, ' ')
  .replace(/[^a-z0-9\u1200-\u137f\s]/g, ' ')
  .replace(/\s+/g, ' ');

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

type ServiceExperience = {
  prompt: string;
  detailPrompt: string;
  placeholder: string;
  helper: string;
  icon: LucideIcon;
  options: string[];
};

const serviceExperiences: Record<string, ServiceExperience> = {
  'appliance-repair': {
    prompt: 'Which appliance needs attention?',
    detailPrompt: 'Help us understand the appliance problem.',
    placeholder: 'Brand, model, and what happens when you switch it on...',
    helper: 'A brand or model number helps us send the right tools.',
    icon: Refrigerator,
    options: ['Fridge is not cooling', 'Washing machine problem', 'Cooker or oven issue', 'Something else'],
  },
  electrician: {
    prompt: 'What is happening with the power?',
    detailPrompt: 'Tell us what is safe to inspect.',
    placeholder: 'Which room, circuit, or appliance is affected?',
    helper: 'If you smell burning or see sparks, switch off power if safe and say so here.',
    icon: Zap,
    options: ['Power outage at home', 'Faulty socket or switch', 'Lights flickering', 'Install a light or appliance'],
  },
  plumber: {
    prompt: 'Where is the water problem?',
    detailPrompt: 'Show us where the water is coming from.',
    placeholder: 'Room, fixture, leak location, and how fast it is dripping...',
    helper: 'Mention whether you can shut off the main water supply.',
    icon: Droplets,
    options: ['Leaking pipe or tap', 'Blocked sink or drain', 'No water or low pressure', 'Install or replace fixture'],
  },
  'ac-refrigeration': {
    prompt: 'What needs cooling again?',
    detailPrompt: 'Give us the cooling system clues.',
    placeholder: 'Room size, temperature, unusual noise, or recent service...',
    helper: 'The unit type and last service date help us prepare for the visit.',
    icon: Settings2,
    options: ['AC is not cooling', 'Refrigerator is warm', 'Strange noise or leak', 'Service or installation'],
  },
  cleaning: {
    prompt: 'What kind of clean do you need?',
    detailPrompt: 'Shape the visit around your home.',
    placeholder: 'Rooms, approximate size, surfaces, and anything needing extra care...',
    helper: 'Tell us about pets, fragile items, or rooms that need special attention.',
    icon: Sparkles,
    options: ['Deep clean my home', 'Move-in or move-out clean', 'Kitchen or bathroom clean', 'Regular home cleaning'],
  },
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
  const { language } = useLanguage();
  return <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5 text-sm text-destructive" data-testid="error-state">
    <div className="flex items-center gap-3"><CircleAlert size={18} /><span>{localized(label, language)}</span></div>
    {retry && <button data-testid="button-retry" onClick={retry} className="mt-3 font-semibold underline underline-offset-4">{localized('Try again', language)}</button>}
  </div>;
}

function EmptyBlock({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  const { language } = useLanguage();
  return <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="empty-state">
    <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-secondary text-primary"><PackageCheck size={20} /></div>
    <h3 className="font-semibold">{localized(title, language)}</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{localized(detail, language)}</p>{action}
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

const marketplaceModes = [
  { id: 'customer', label: 'Customer', description: 'I need something done' },
  { id: 'provider', label: 'Provider', description: 'I can do the work' },
  { id: 'admin', label: 'Admin', description: 'Operations overview' },
] as const;

function ModeSwitcher({ value, availableModes, onChange }: { value: MarketplaceMode; availableModes: (typeof marketplaceModes)[number][]; onChange: (mode: MarketplaceMode) => void }) {
  const { language } = useLanguage();
  return <div className="inline-flex w-full max-w-xl rounded-full border border-border bg-card p-1 shadow-sm">
    {availableModes.map((mode) => (
      <button
        key={mode.id}
        type="button"
        onClick={() => onChange(mode.id)}
        data-testid={`button-mode-${mode.id}`}
        className={`flex-1 rounded-full px-3 py-2 text-left transition ${value === mode.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary'}`}
      >
        <div className="text-sm font-bold">{mode.label}</div>
        <div className={`text-[10px] ${value === mode.id ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{localized(mode.description, language)}</div>
      </button>
    ))}
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const activeNav = customerNav.find((item) => item.href === location || (item.href !== '/' && location.startsWith(item.href)));
  return <div className="noise min-h-[100dvh] bg-background text-foreground">
    <div className="mx-auto max-w-[1240px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border/75 bg-background/95 px-4 backdrop-blur-sm md:px-9">
        <div className="flex items-center gap-3"><Mark /></div>
        <div className="hidden items-center gap-2 md:flex"><MapPin size={14} className="text-primary" /><span className="text-sm font-medium">Addis Ababa</span><span className="text-xs text-muted-foreground">· local desk</span></div>
        <div className="flex items-center gap-2"><button onClick={() => setLanguage(language === 'en' ? 'am' : 'en')} aria-label="Change language" data-testid="button-language" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-bold text-muted-foreground transition hover:border-primary hover:text-primary"><Languages size={15} /> {language === 'en' ? 'አማ' : 'EN'}</button><button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="Change color theme" data-testid="button-theme" className="grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary hover:text-primary">{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button><button onClick={() => window.alert('You are all caught up.')} data-testid="button-notifications" className="grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary hover:text-primary"><Bell size={17} /></button><button data-testid="button-mobile-menu" onClick={() => setMenuOpen(!menuOpen)} className="grid size-9 place-items-center rounded-full border border-border bg-card md:hidden">{menuOpen ? <X size={17} /> : <Menu size={17} />}</button></div>
      </header>
      {menuOpen && <div className="absolute right-4 top-[60px] z-30 w-56 rounded-xl border border-border bg-card p-2 shadow-lg md:hidden">{customerNav.map(({ href, label, icon: NavIcon }) => <Link key={href} onClick={() => setMenuOpen(false)} href={href} data-testid={`link-mobile-${label.toLowerCase().replaceAll(' ', '-')}`} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm hover:bg-secondary"><NavIcon size={16} />{localized(label, language)}</Link>)}</div>}
      <main className="page-in mx-auto max-w-[1240px] px-4 pb-28 pt-7 md:px-9 md:pb-10 md:pt-9">{children}</main>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-border bg-card/95 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm md:hidden">{customerNav.map(({ href, label, icon: NavIcon }) => <Link key={href} href={href} data-testid={`link-bottom-${label.toLowerCase().replaceAll(' ', '-')}`} className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold ${activeNav?.href === href ? 'text-primary' : 'text-muted-foreground'}`}><NavIcon size={19} strokeWidth={activeNav?.href === href ? 2.2 : 1.8} />{localized(label, language)}</Link>)}</nav>
  </div>;
}

function ServiceCard({ service, actual }: { service: LaunchService; actual?: Service }) {
  const { language } = useLanguage();
  const ServiceIcon = service.icon;
  return <Link href={`/request/${actual?.slug || service.slug}`} data-testid={`card-service-${service.slug}`} className="group flex min-h-[144px] flex-col justify-between border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-[4px_4px_0_hsl(var(--accent))]">
    <div className="flex items-start justify-between"><div className={`grid size-10 place-items-center ${service.color} text-primary`}><ServiceIcon size={20} strokeWidth={1.8} /></div><ArrowRight size={17} className="text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div>
    <div><h3 className="mt-4 text-sm font-bold">{localized(service.name, language)}</h3><p className="mt-1 text-xs text-muted-foreground">{localized(service.description, language)}</p></div>
  </Link>;
}

function Home() {
  const { language } = useLanguage();
  const { user, updateUser } = useAuth();
  const services = useListServices();
  const summary = useGetDashboardSummary();
  const requests = useListServiceRequests();
  const serviceList = Array.isArray(services.data) ? services.data : [];
  const requestList = Array.isArray(requests.data) ? requests.data : [];
  const recent = Array.isArray(summary.data?.recentRequests) ? summary.data.recentRequests : requestList;
  const actualFor = (slug: string) => serviceList.find((item) => item.slug === slug || item.name.toLowerCase().replaceAll(' ', '-') === slug);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [mode, setMode] = useState<MarketplaceMode>(user.activeMode.toLowerCase() as MarketplaceMode);
  const [modeError, setModeError] = useState('');
  const availableModes = marketplaceModes.filter((entry) => user.roles.includes(entry.id.toUpperCase()));
  useEffect(() => {
    setMode(user.activeMode.toLowerCase() as MarketplaceMode);
  }, [user.activeMode]);
  const changeMode = async (nextMode: MarketplaceMode) => {
    setModeError('');
    try {
      const response = await fetch('/api/auth/mode', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: nextMode.toUpperCase() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setModeError(body.error || 'Could not change account mode.');
        return;
      }
      const body = await response.json();
      updateUser(body.user);
      setMode(nextMode);
    } catch {
      setModeError('Could not reach Melse to change account mode.');
    }
  };
  const searchResults = useMemo(() => {
    const query = normalizeSearchText(searchValue);
    if (!query) return [];
    return serviceList
      .map((service) => {
        const name = normalizeSearchText(service.name);
        const haystack = `${name} ${normalizeSearchText(service.description)}`;
        if (!haystack) return { service, score: Number.NEGATIVE_INFINITY };
        const exact = haystack.includes(query) ? 100 : 0;
        const startsWith = name.startsWith(query) ? 60 : 0;
        const tokenMatch = query.split(' ').every((token) => haystack.includes(token)) ? 35 : 0;
        const score = exact + startsWith + tokenMatch;
        return { service, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((entry) => entry.service);
  }, [searchValue, serviceList]);

  const modeContent = {
    customer: {
      heroTitle: 'What do you need help with?',
      heroDetail: 'Tell us the problem and we’ll match the right trusted local professional in Addis Ababa.',
      primaryAction: 'Describe a job',
      secondaryAction: 'Browse services',
    },
    provider: {
      heroTitle: 'Your work, organized.',
      heroDetail: 'Go online, manage requests, and build steady income from your service area.',
      primaryAction: 'Open provider dashboard',
      secondaryAction: 'View schedule',
    },
    admin: {
      heroTitle: 'Marketplace operations at a glance.',
      heroDetail: 'Monitor bookings, provider verification, payments, and service quality across the platform.',
      primaryAction: 'Open admin desk',
      secondaryAction: 'Review flags',
    },
  }[mode];

  return <div className="space-y-8">
    <section className="rounded-[28px] border border-border bg-gradient-to-br from-primary via-primary to-primary/90 p-5 text-primary-foreground shadow-[0_24px_50px_rgba(13,61,42,0.18)] md:p-8">
      <div className="mb-5 flex justify-center md:justify-start">
        <ModeSwitcher value={mode} availableModes={availableModes} onChange={changeMode} />
      </div>
      {modeError && <p role="alert" className="mb-4 text-sm text-destructive">{modeError}</p>}
      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
        <div>
          <p className="mono-font text-[10px] uppercase tracking-[.22em] text-accent">Melse marketplace</p>
          <h1 className="mt-4 max-w-xl text-[2.5rem] font-bold leading-[.96] tracking-[-.05em] md:text-5xl">{localized(modeContent.heroTitle, language)}</h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-primary-foreground/75">{localized(modeContent.heroDetail, language)}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {mode === 'customer' ? (
              <>
                <Link href="/services" data-testid="button-primary-mode" className="inline-flex min-h-11 items-center justify-center gap-2 bg-accent px-5 text-sm font-bold text-accent-foreground">{localized(modeContent.primaryAction, language)} <ArrowRight size={16} /></Link>
                <Link href="/jobs" data-testid="button-secondary-mode" className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary-foreground/25 bg-primary-foreground/5 px-5 text-sm font-bold text-primary-foreground">{localized(modeContent.secondaryAction, language)}</Link>
              </>
            ) : mode === 'provider' ? (
              <>
                <Link href="/technician" data-testid="button-primary-mode" className="inline-flex min-h-11 items-center justify-center gap-2 bg-accent px-5 text-sm font-bold text-accent-foreground">{localized(modeContent.primaryAction, language)} <ArrowRight size={16} /></Link>
                <Link href="/admin" data-testid="button-secondary-mode" className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary-foreground/25 bg-primary-foreground/5 px-5 text-sm font-bold text-primary-foreground">{localized(modeContent.secondaryAction, language)}</Link>
              </>
            ) : (
              <>
                <Link href="/admin" data-testid="button-primary-mode" className="inline-flex min-h-11 items-center justify-center gap-2 bg-accent px-5 text-sm font-bold text-accent-foreground">{localized(modeContent.primaryAction, language)} <ArrowRight size={16} /></Link>
                <Link href="/jobs" data-testid="button-secondary-mode" className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary-foreground/25 bg-primary-foreground/5 px-5 text-sm font-bold text-primary-foreground">{localized(modeContent.secondaryAction, language)}</Link>
              </>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-primary-foreground/15 bg-primary-foreground/5 p-4 backdrop-blur-sm">
          <p className="mono-font text-[10px] uppercase tracking-[.18em] text-primary-foreground/70">Marketplace health</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <MetricCard label="Verified providers" value="128+" detail="Across Addis" />
            <MetricCard label="Today’s jobs" value="54" detail="Booked & active" />
            <MetricCard label="Avg. response" value="18 min" detail="From request to match" />
          </div>
        </div>
      </div>
    </section>

    <section className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          data-testid="input-service-search"
          type="search"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder={localized('Search for a service', language)}
          className="h-12 w-full border border-border bg-card pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-accent/30"
        />
        {searchValue && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-xl border border-border bg-card p-2 shadow-lg">
            {searchResults.map((service) => (
              <Link key={service.slug} href={`/request/${service.slug}`} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{localized(service.name, language)}</p>
                  <p className="text-xs text-muted-foreground">{localized(service.description, language)}</p>
                </div>
                <ArrowRight size={15} className="text-primary" />
              </Link>
            ))}
          </div>
        )}
      </div>
      <button onClick={() => setEmergencyOpen(!emergencyOpen)} data-testid="button-emergency" className={`inline-flex min-h-12 items-center justify-center gap-2 border px-4 text-sm font-bold transition ${emergencyOpen ? 'border-destructive bg-destructive text-destructive-foreground' : 'border-destructive/35 bg-card text-destructive hover:bg-destructive/5'}`}><Zap size={17} /> {localized('Need help now?', language)}</button>
    </section>

    {emergencyOpen && <div className="flex flex-col gap-4 border border-destructive/25 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="panel-emergency"><div><p className="text-sm font-bold text-destructive">{localized('Need help now?', language)}</p><p className="mt-1 text-xs text-muted-foreground">For immediate danger, contact the relevant emergency authority first. Melse is not an emergency service.</p></div><Link href="/emergency" data-testid="button-emergency-choose" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 bg-destructive px-4 text-xs font-bold text-destructive-foreground">{localized('Get Help Now', language)} <ArrowRight size={15} /></Link></div>}

    {summary.data?.activeBooking && <ActiveBookingCard booking={summary.data.activeBooking} />}

    <section id="services" className="scroll-mt-24">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">01 / {localized('Launch services', language)}</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">{localized('What can we help with?', language)}</h2>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:block">{localized('Verified local help in Addis', language)}</span>
      </div>
      {services.isLoading ? <LoadingBlock lines={2} /> : services.isError ? <ErrorBlock retry={() => services.refetch()} /> : <div className="grid grid-cols-2 gap-2 md:grid-cols-5">{launchServices.map((service) => <ServiceCard key={service.slug} service={service} actual={actualFor(service.slug)} />)}</div>}
      <div className="mt-4 flex justify-end"><Link href="/services" data-testid="link-see-all-services" className="inline-flex items-center gap-2 text-sm font-bold text-primary">{localized('See all services', language)} <ArrowRight size={15} /></Link></div>
    </section>

    <section className="grid gap-8 lg:grid-cols-[1.35fr_.65fr]">
      <div>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">02 / {localized('Your activity', language)}</p>
            <h2 className="mt-2 text-xl font-bold">{localized('Recent services', language)}</h2>
          </div>
          <Link href="/jobs" data-testid="link-see-all-jobs" className="text-xs font-bold text-primary">{localized('See all', language)}</Link>
        </div>
        {requests.isLoading && !recent.length ? <LoadingBlock lines={2} /> : requests.isError && !recent.length ? <ErrorBlock retry={() => requests.refetch()} /> : recent.length ? <div className="divide-y divide-border border border-border bg-card">{recent.slice(0, 4).map((request) => <Link href={`/job/${request.id}`} key={request.id} data-testid={`row-request-${request.id}`} className="flex items-center gap-3 p-4 transition hover:bg-secondary/40"><div className="grid size-9 shrink-0 place-items-center bg-secondary text-primary"><IconFor name={request.serviceSlug} size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{request.problem}</p><p className="mt-1 truncate text-xs text-muted-foreground">{request.address} · {dateLabel(request.createdAt)}</p></div><div className="hidden text-right sm:block"><p className="mono-font text-[11px]">{money(request.priceMin)}–{money(request.priceMax)}</p><p className="mt-1 text-[10px] text-muted-foreground">{request.arrival}</p></div><ChevronRight size={16} className="text-muted-foreground" /></Link>)}</div> : <EmptyBlock title={localized('Your service history is clear', language)} detail={localized('When you request help, your recent service will appear here.', language)} action={<Link href="#services" data-testid="link-empty-start" className="mt-4 inline-flex text-sm font-bold text-primary">{localized('Start a request', language)} <ArrowRight size={15} className="ml-1" /></Link>} />}
      </div>
      <div className="border border-border bg-secondary/55 p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">{localized('Why Melse', language)}</p>
            <h2 className="mt-2 text-xl font-bold">{localized('A safer way to call for help.', language)}</h2>
          </div>
          <ShieldCheck size={24} className="text-primary" />
        </div>
        <div className="mt-6 space-y-4"><TrustLine icon={BadgeCheck} title={localized('Verified people', language)} /><TrustLine icon={FileText} title={localized('Clear ETB estimate', language)} /><TrustLine icon={MessageCircle} title={localized('A desk that follows up', language)} /></div>
      </div>
    </section>
  </div>;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-primary-foreground/10 bg-primary-foreground/5 p-3">
    <p className="mono-font text-[9px] uppercase tracking-[.14em] text-primary-foreground/70">{label}</p>
    <p className="mt-2 text-2xl font-bold">{value}</p>
    <p className="mt-1 text-xs text-primary-foreground/70">{detail}</p>
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
  const { language } = useLanguage();
  const services = useListServices();
  const [, setLocation] = useLocation();
  const normalizedServiceSlug = serviceSlug === 'electrical' ? 'electrician' : serviceSlug === 'plumbing' ? 'plumber' : serviceSlug;
  const serviceList = Array.isArray(services.data) ? services.data : [];
  const [step, setStep] = useState(1);
  const [problem, setProblem] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [urgency, setUrgency] = useState('This week');
  const [preferredAt, setPreferredAt] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [locationError, setLocationError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const service = launchServices.find((item) => item.slug === normalizedServiceSlug);
  const actual = serviceList.find((item) => item.slug === normalizedServiceSlug);
  const experience = serviceExperiences[normalizedServiceSlug] ?? {
    prompt: 'Tell us what needs attention',
    detailPrompt: 'Give us the useful detail.',
    placeholder: 'Describe what is happening...',
    helper: 'A few words help us send the right person first time.',
    icon: Wrench,
    options: issueSets[normalizedServiceSlug] ?? ['Repair or replacement', 'Installation', 'Something else'],
  };
  const canNext = step === 1 ? Boolean(problem) : step === 2 ? description.trim().length > 5 : Boolean(address.trim())
    && (!budgetMin || Number.isFinite(Number(budgetMin)))
    && (!budgetMax || Number.isFinite(Number(budgetMax)))
    && (!budgetMin || !budgetMax || Number(budgetMax) >= Number(budgetMin));
  const shareLocation = () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Location is not supported by this browser. You can continue with your written address.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords: position }) => setCoordinates({ latitude: position.latitude, longitude: position.longitude }),
      () => setLocationError('Could not get your location. You can continue with your written address.'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const submit = async () => {
    if (saving || !actual) return;
    setSaving(true);
    setSubmitError('');
    const data = {
      serviceSlug: actual.slug,
      problem,
      description,
      address,
      urgency,
      ...(preferredAt ? { preferredAt: new Date(preferredAt).toISOString() } : {}),
      ...(budgetMin ? { budgetMin: Number(budgetMin) } : {}),
      ...(budgetMax ? { budgetMax: Number(budgetMax) } : {}),
      ...(coordinates ?? {}),
    };
    try {
      const payloadHash = JSON.stringify(data);
      const storageKey = `melse-request-key:${actual.slug}`;
      const saved = sessionStorage.getItem(storageKey);
      let idempotencyKey: string;
      if (saved) {
        const parsedSaved = JSON.parse(saved) as { payloadHash?: string; key?: string };
        idempotencyKey = parsedSaved.payloadHash === payloadHash && parsedSaved.key
          ? parsedSaved.key
          : crypto.randomUUID();
      } else {
        idempotencyKey = crypto.randomUUID();
      }
      sessionStorage.setItem(storageKey, JSON.stringify({ payloadHash, key: idempotencyKey }));
      const response = await fetch('/api/service-requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not submit the service request.');
      sessionStorage.removeItem(storageKey);
      setLocation(`/technicians/${result.id}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Could not submit the service request.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="mx-auto max-w-3xl">
    <Link href="/" data-testid="link-back-home" className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /> {localized('Back', language)}</Link>
    <div className="mb-7"><div className="flex gap-2">{[1, 2, 3].map((number) => <span key={number} className={`h-1.5 flex-1 ${number <= step ? 'bg-primary' : 'bg-border'}`} />)}</div><div className="mt-4 flex items-center justify-between"><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">{localized('Request help', language)} · 0{step} {localized('of', language)} 03</p><span className="text-xs font-semibold text-muted-foreground">{service ? localized(service.name, language) : localized(actual?.name ?? normalizedServiceSlug, language)}</span></div><h1 className="mt-3 text-4xl font-bold leading-[.98] tracking-[-.04em] md:text-5xl">{localized(step === 1 ? experience.prompt : step === 2 ? experience.detailPrompt : 'Where should we come?', language)}</h1></div>
    {services.isLoading ? <LoadingBlock lines={3} /> : services.isError ? <ErrorBlock retry={() => services.refetch()} /> : <div className="border border-border bg-card p-4 md:p-7">
      {step === 1 && <ServiceBrief experience={experience} selected={problem} onSelect={setProblem} language={language} />}
      {step === 2 && <div><label htmlFor="request-description" className="text-sm font-bold">{localized(experience.detailPrompt, language)}</label><p className="mt-1 text-sm text-muted-foreground">{localized(experience.helper, language)}</p><textarea id="request-description" data-testid="input-request-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={localized(experience.placeholder, language)} className="mt-5 min-h-40 w-full resize-none border border-input bg-background p-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-accent/30" /><p className="mt-2 text-xs text-muted-foreground">Photo uploads are not available yet; no image will be sent or stored.</p><p className="mt-1 text-right text-xs text-muted-foreground">{description.length} {localized('characters', language)}</p></div>}
      {step === 3 && <div className="space-y-6"><div><label htmlFor="request-address" className="text-sm font-bold">{localized('Your Addis Ababa address', language)}</label><p className="mt-1 text-sm text-muted-foreground">{localized('A house, building, or area is enough to start.', language)}</p><div className="relative mt-3"><MapPin size={17} className="absolute left-4 top-4 text-primary" /><input id="request-address" data-testid="input-request-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Bole, Kazanchis, CMC..." className="h-14 w-full border border-input bg-background pl-11 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-accent/30" /></div><button type="button" onClick={shareLocation} className="mt-2 text-xs font-semibold text-primary underline">Share current location (optional)</button>{coordinates && <p className="mt-1 text-xs text-muted-foreground">Location attached for distance-based provider search.</p>}{locationError && <p role="alert" className="mt-1 text-xs text-destructive">{locationError}</p>}</div><div><p className="text-sm font-bold">{localized('When do you need it?', language)}</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{['Today', 'This week', 'Just planning'].map((item) => <button type="button" key={item} onClick={() => setUrgency(item)} data-testid={`button-urgency-${item.toLowerCase().replaceAll(' ', '-')}`} className={`min-h-16 border px-3 py-3 text-left text-sm transition ${urgency === item ? 'border-primary bg-secondary font-bold text-primary' : 'border-border hover:border-primary/50'}`}><Clock3 size={16} className="mb-2" />{localized(item, language)}</button>)}</div><label htmlFor="request-preferred-at" className="mt-4 block text-sm font-semibold">Preferred date and time (optional)<input id="request-preferred-at" type="datetime-local" min={new Date().toISOString().slice(0, 16)} value={preferredAt} onChange={(event) => setPreferredAt(event.target.value)} className="mt-2 h-11 w-full border border-input bg-background px-3" /></label></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Minimum budget, ETB (optional)<input type="number" min="0" step="0.01" value={budgetMin} onChange={(event) => setBudgetMin(event.target.value)} className="mt-2 h-11 w-full border border-input bg-background px-3" /></label><label className="text-sm font-semibold">Maximum budget, ETB (optional)<input type="number" min="0" step="0.01" value={budgetMax} onChange={(event) => setBudgetMax(event.target.value)} className="mt-2 h-11 w-full border border-input bg-background px-3" /></label></div><div className="flex gap-3 bg-secondary/60 p-4 text-sm text-muted-foreground"><ShieldCheck className="shrink-0 text-primary" size={18} /><p>Estimate for this service: <strong className="text-foreground">{actual ? `${money(actual.startingPrice)}–${money(actual.priceMax)}` : 'Estimate unavailable until service pricing is configured.'}</strong>. The final price is confirmed with the provider.</p></div></div>}
      <div className="mt-7 flex items-center justify-between border-t border-border pt-5"><button data-testid="button-request-back" onClick={() => setStep(Math.max(1, step - 1))} className={`text-sm font-bold ${step === 1 ? 'invisible' : ''}`}>{localized('Back', language)}</button>{step < 3 ? <button disabled={!canNext} data-testid="button-request-next" onClick={() => setStep(step + 1)} className="inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-35">{localized('Continue', language)} <ChevronRight size={17} /></button> : <button disabled={!canNext || saving} data-testid="button-submit-request" onClick={() => void submit()} className="inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-35">{saving ? localized('Sending request...', language) : localized('See estimate and people', language)} <ArrowRight size={17} /></button>}</div>
      {submitError && <p role="alert" className="mt-4 text-right text-sm text-destructive" data-testid="text-request-error">{submitError}</p>}
    </div>}
  </div>;
}

function PlusMark() {
  return <span className="text-lg font-normal text-muted-foreground">+</span>;
}

function ServiceBrief({ experience, selected, onSelect, language }: { experience: ServiceExperience; selected: string; onSelect: (value: string) => void; language: Language }) {
  const ExperienceIcon = experience.icon;
  return <div>
    <div className="mb-5 flex items-start gap-3 border-b border-border pb-5"><span className="grid size-11 shrink-0 place-items-center bg-secondary text-primary"><ExperienceIcon size={21} /></span><div><p className="mono-font text-[10px] uppercase tracking-[.14em] text-primary">Service-specific check</p><p className="mt-1 text-sm text-muted-foreground">{localized('Choose the closest match. You can explain more next.', language)}</p></div></div>
    <div className="grid gap-2 sm:grid-cols-2">{experience.options.map((option) => <button key={option} onClick={() => onSelect(option)} data-testid={`button-problem-${option.toLowerCase().replaceAll(' ', '-')}`} className={`flex min-h-16 items-center justify-between border p-4 text-left text-sm font-semibold transition ${selected === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/60 hover:bg-secondary'}`}><span>{localized(option, language)}</span>{selected === option ? <Check size={17} /> : <PlusMark />}</button>)}</div>
  </div>;
}

function TechnicianPicker() {
  const { requestId = '' } = useParams<{ requestId: string }>();
  const technicians = useListTechnicians({ requestId }, { query: { queryKey: getListTechniciansQueryKey({ requestId }) } });
  const requests = useListServiceRequests();
  const create = useCreateBooking();
  const [, setLocation] = useLocation();
  const requestList = Array.isArray(requests.data) ? requests.data : [];
  const request = requestList.find((item) => item.id === requestId);
  const [selected, setSelected] = useState('');
  const available = Array.isArray(technicians.data) ? technicians.data.filter((tech) => tech.available) : [];
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
  const { user } = useAuth();
  const [quote, setQuote] = useState('');
  const [paymentEmail, setPaymentEmail] = useState('');
  const [rating, setRating] = useState('5');
  const [review, setReview] = useState('');
  const [disputeReason, setDisputeReason] = useState('QUALITY');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [feedback, setFeedback] = useState('');
  const payment = useMutation({
    mutationFn: () => apiFetch<{ redirectUrl: string }>(`/bookings/${id}/payment`, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumber: user.phoneNumber,
        email: paymentEmail,
        returnUrl: `${window.location.origin}/booking/${id}`,
      }),
    }),
    onSuccess: (result) => window.location.assign(result.redirectUrl),
  });
  const verify = useMutation({
    mutationFn: (transactionId: string) => apiFetch(`/payments/${encodeURIComponent(transactionId)}/verify`, { method: 'POST' }),
    onSuccess: async () => {
      setFeedback('Payment status was checked with the payment provider.');
      await bookingQuery.refetch();
    },
  });
  const submitReview = useMutation({
    mutationFn: () => apiFetch(`/bookings/${id}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating: Number(rating), ...(review.trim() ? { comment: review.trim() } : {}) }),
    }),
    onSuccess: async () => {
      setFeedback('Your review was saved.');
      await bookingQuery.refetch();
    },
  });
  const submitDispute = useMutation({
    mutationFn: () => apiFetch(`/bookings/${id}/disputes`, {
      method: 'POST',
      body: JSON.stringify({ reason: disputeReason, description: disputeDescription }),
    }),
    onSuccess: async () => {
      setFeedback('Your dispute was submitted for review.');
      setDisputeDescription('');
      await bookingQuery.refetch();
    },
  });
  const booking = bookingQuery.data;
  useEffect(() => {
    const transactionId = new URLSearchParams(window.location.search).get('tx_ref')
      ?? new URLSearchParams(window.location.search).get('transaction_id');
    if (!transactionId) return;
    verify.mutate(transactionId);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);
  if (bookingQuery.isLoading) return <div className="mx-auto max-w-3xl"><LoadingBlock lines={5} /></div>;
  if (bookingQuery.isError || !booking) return <div className="mx-auto max-w-3xl"><ErrorBlock label="We could not find this booking." retry={() => bookingQuery.refetch()} /></div>;
  const currentIndex = statusOrder.indexOf(booking.status as typeof statusOrder[number]);
  const completed = ['COMPLETED', 'CUSTOMER_CONFIRMED', 'PAID', 'RATED'].includes(booking.status);
  const providerMode = user.roles.includes('PROVIDER') && user.activeMode === 'PROVIDER';
  const nextProviderStatus: Record<string, string> = {
    ASSIGNED: 'ACCEPTED',
    ACCEPTED: 'TECHNICIAN_EN_ROUTE',
    TECHNICIAN_EN_ROUTE: 'ARRIVED',
    ARRIVED: 'IN_PROGRESS',
    IN_PROGRESS: 'COMPLETED',
  };
  const providerNext = providerMode ? nextProviderStatus[booking.status] : undefined;
  const customerCanConfirm = !providerMode && booking.status === 'COMPLETED';
  const statusAction = providerNext ?? (customerCanConfirm ? 'CUSTOMER_CONFIRMED' : undefined);
  const updateStatus = (status: string) => update.mutate({
    id,
    data: {
      status: status as BookingStatusInputStatus,
      ...(status === 'ACCEPTED' && quote ? { quotedPrice: Number(quote) } : {}),
    },
  }, { onSuccess: (updated) => {
    client.setQueryData(getGetBookingQueryKey(id), updated);
    setFeedback('');
  } });
  const canDispute = ['IN_PROGRESS', 'COMPLETED', 'CUSTOMER_CONFIRMED', 'PAID', 'RATED'].includes(booking.status);
  return <div className="mx-auto max-w-4xl">
    <Link href="/" data-testid="link-booking-home" className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /> Home</Link>
    <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">Booking #{booking.id.slice(-6)}</p><h1 className="mt-3 text-4xl font-bold leading-none tracking-[-.04em] md:text-5xl">{completed ? 'Job complete.' : 'Booking update'}<br /><span className="display-font font-normal italic">{completed ? 'Thank you.' : 'Your service details.'}</span></h1></div><span data-testid="status-booking" className="inline-flex w-fit items-center gap-2 bg-accent/25 px-3 py-2 text-xs font-bold text-primary"><span className="size-2 rounded-full bg-primary" />{titleCase(booking.status)}</span></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="border border-border bg-card p-5 md:p-7">
        <div className="flex items-start justify-between border-b border-border pb-5"><div><p className="text-sm font-bold">{booking.serviceName}</p><p className="mt-1 text-sm text-muted-foreground">with {booking.technicianName}</p></div><div className="text-right"><p className="mono-font text-sm">{booking.finalPrice === null ? `${money(booking.priceMin)}–${money(booking.priceMax)}` : money(booking.finalPrice)}</p><p className="mt-1 text-xs text-muted-foreground">{booking.finalPrice === null ? 'estimate' : 'provider-confirmed price'}</p></div></div>
        <StatusTimeline currentIndex={currentIndex} />
        <div className="mt-6 flex items-start gap-3 bg-secondary/60 p-4 text-sm"><MapPin size={17} className="mt-0.5 shrink-0 text-primary" /><div><p className="font-bold">{booking.address}</p><p className="mt-1 text-xs text-muted-foreground">Arrival: {booking.eta}</p></div></div>
        <div className="mt-5 flex flex-wrap gap-2">
          {statusAction && <div className="flex w-full flex-col gap-2 sm:flex-row">
            {providerNext === 'ACCEPTED' && <label className="min-w-0 flex-1 text-xs font-semibold">Total quote in ETB (if required)<input type="number" min="0.01" step="0.01" value={quote} onChange={(event) => setQuote(event.target.value)} className="mt-1 min-h-10 w-full border border-input bg-background px-3 text-sm" /></label>}
            <button onClick={() => updateStatus(statusAction)} disabled={update.isPending} className="min-h-10 bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">{update.isPending ? 'Saving…' : statusAction === 'CUSTOMER_CONFIRMED' ? 'Confirm completed service' : `Mark ${titleCase(statusAction)}`}</button>
          </div>}
          {booking.status === 'CUSTOMER_CONFIRMED' && !providerMode && <form onSubmit={(event) => { event.preventDefault(); payment.mutate(); }} className="grid w-full gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-semibold">Email for payment<input type="email" required value={paymentEmail} onChange={(event) => setPaymentEmail(event.target.value)} className="mt-1 min-h-10 w-full border border-input bg-background px-3 text-sm" /></label><p className="self-end pb-3 text-xs text-muted-foreground">Phone: {user.phoneNumber}</p><button disabled={payment.isPending} className="min-h-10 bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">{payment.isPending ? 'Connecting…' : 'Pay securely'}</button></form>}
          {['PAID', 'RATED'].includes(booking.status) && !providerMode && <form onSubmit={(event) => { event.preventDefault(); submitReview.mutate(); }} className="grid w-full gap-2 sm:grid-cols-[120px_1fr_auto]"><label className="text-xs font-semibold">Rating<select value={rating} onChange={(event) => setRating(event.target.value)} className="mt-1 min-h-10 w-full border border-input bg-background px-3 text-sm">{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} star{value === 1 ? '' : 's'}</option>)}</select></label><label className="text-xs font-semibold">Review (optional)<input value={review} onChange={(event) => setReview(event.target.value)} maxLength={2000} className="mt-1 min-h-10 w-full border border-input bg-background px-3 text-sm" /></label><button disabled={submitReview.isPending} className="min-h-10 border border-primary px-4 text-sm font-bold text-primary">{submitReview.isPending ? 'Saving…' : 'Submit review'}</button></form>}
          {canDispute && <form onSubmit={(event) => { event.preventDefault(); submitDispute.mutate(); }} className="grid w-full gap-2 border-t border-border pt-4 sm:grid-cols-[150px_1fr_auto]"><label className="text-xs font-semibold">Issue<select value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} className="mt-1 min-h-10 w-full border border-input bg-background px-3 text-sm">{['QUALITY', 'NO_SHOW', 'SAFETY', 'PRICE', 'DAMAGE', 'OTHER'].map((reason) => <option key={reason} value={reason}>{titleCase(reason)}</option>)}</select></label><label className="text-xs font-semibold">Describe the issue<input required minLength={10} maxLength={5000} value={disputeDescription} onChange={(event) => setDisputeDescription(event.target.value)} className="mt-1 min-h-10 w-full border border-input bg-background px-3 text-sm" /></label><button disabled={submitDispute.isPending} className="min-h-10 border border-destructive px-4 text-sm font-bold text-destructive">{submitDispute.isPending ? 'Sending…' : 'Open dispute'}</button></form>}
        </div>
        {(update.isError || payment.isError || verify.isError || submitReview.isError || submitDispute.isError) && <p role="alert" className="mt-3 text-sm text-destructive">{update.error?.message || payment.error?.message || verify.error?.message || submitReview.error?.message || submitDispute.error?.message}</p>}
        {feedback && <p role="status" className="mt-3 text-sm text-primary">{feedback}</p>}
      </section>
      <aside className="space-y-3"><div className="border border-border bg-secondary/55 p-5"><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">Booking details</p><p className="mt-3 text-sm leading-relaxed">The estimate is not a payment amount. Review the provider-confirmed price before confirming completion and paying.</p></div><Link href="/messages" data-testid="link-booking-messages" className="flex min-h-12 items-center justify-between border border-border bg-card px-4 text-sm font-bold transition hover:border-primary">Open booking messages <MessageCircle size={16} className="text-primary" /></Link><Link href="/support" data-testid="link-booking-support" className="flex min-h-12 items-center justify-between border border-border bg-card px-4 text-sm font-bold transition hover:border-primary">Need support? <ArrowRight size={16} className="text-primary" /></Link></aside>
    </div>
  </div>;
}

function StatusTimeline({ currentIndex }: { currentIndex: number }) {
  const stages = ['Request received', 'Professional selected', 'On the way', 'Work in progress', 'Complete'];
  const stageIndexes = [0, 3, 4, 6, 7];
  return <div className="mt-7 space-y-0">{stages.map((stage, index) => { const done = currentIndex >= stageIndexes[index]; const current = index === stages.length - 1 ? currentIndex >= stageIndexes[index] : currentIndex < stageIndexes[index] && currentIndex >= (stageIndexes[index - 1] ?? 0); return <div key={stage} className="flex gap-3"><div className="flex flex-col items-center"><span className={`grid size-7 place-items-center rounded-full border ${done ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>{done ? <Check size={14} /> : <span className="size-1.5 rounded-full bg-current" />}</span>{index < stages.length - 1 && <span className={`my-1 h-8 w-px ${done ? 'bg-primary' : 'bg-border'}`} />}</div><div className="pb-4 pt-1"><p className={`text-sm ${done || current ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{stage}</p>{current && <p className="mt-1 text-xs text-primary">Current stage</p>}</div></div>; })}</div>;
}

function Jobs() {
  const requests = useListServiceRequests();
  const summary = useGetDashboardSummary();
  const rows = Array.isArray(requests.data) ? requests.data : [];
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
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState('');
  const [draft, setDraft] = useState('');
  const conversations = useQuery({
    queryKey: ['marketplace', 'conversations'],
    queryFn: () => apiFetch<Array<{ bookingId: string; conversationId: string | null; serviceName: string; status: string; lastMessageAt: string | null }>>('/conversations'),
  });
  const selected = conversations.data?.find((conversation) => conversation.conversationId === conversationId)
    ?? conversations.data?.find((conversation) => conversation.conversationId)
    ?? null;
  useEffect(() => {
    if (selected?.conversationId && selected.conversationId !== conversationId) setConversationId(selected.conversationId);
  }, [selected?.conversationId, conversationId]);
  const messages = useQuery({
    queryKey: ['marketplace', 'messages', selected?.conversationId],
    queryFn: () => apiFetch<Array<{ id: string; senderId: string; body: string; createdAt: string; readAt: string | null }>>(`/conversations/${selected!.conversationId}/messages`),
    enabled: Boolean(selected?.conversationId),
    refetchInterval: 5000,
  });
  const send = useMutation({
    mutationFn: () => apiFetch(`/conversations/${selected!.conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: draft }),
    }),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['marketplace', 'messages', selected?.conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['marketplace', 'conversations'] });
    },
  });
  const { user } = useAuth();
  const messageRows = messages.data ?? [];
  return <PageIntro eyebrow="Melse" title="Messages" detail="Persistent, booking-specific conversations with your service provider.">
    {conversations.isLoading ? <LoadingBlock lines={4} /> : conversations.isError ? <ErrorBlock retry={() => conversations.refetch()} /> : !conversations.data?.some((conversation) => conversation.conversationId) ? <EmptyBlock title="No booking conversations yet" detail="Messages become available after a provider is assigned to a booking." /> : <div className="grid min-h-[60vh] gap-4 md:grid-cols-[280px_1fr]">
      <div className="divide-y divide-border border border-border bg-card">
        {conversations.data.filter((conversation) => conversation.conversationId).map((conversation) => <button key={conversation.conversationId} type="button" onClick={() => setConversationId(conversation.conversationId!)} className={`w-full p-4 text-left hover:bg-secondary/50 ${conversation.conversationId === selected?.conversationId ? 'bg-secondary' : ''}`}>
          <p className="truncate text-sm font-bold">{conversation.serviceName}</p>
          <p className="mt-1 text-xs text-muted-foreground">Booking · {conversation.status.toLowerCase().replaceAll('_', ' ')}</p>
        </button>)}
      </div>
      <section className="flex min-h-[60vh] flex-col border border-border bg-card">
        <div className="border-b border-border p-4"><p className="font-bold">{selected?.serviceName}</p><p className="mt-1 text-xs text-muted-foreground">Only booking participants can read or send these messages.</p></div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {messages.isLoading ? <LoadingBlock lines={3} /> : messages.isError ? <ErrorBlock retry={() => messages.refetch()} /> : messageRows.length ? messageRows.map((message) => <div key={message.id} className={`max-w-[85%] p-3 text-sm ${message.senderId === user.id ? 'ml-auto bg-primary text-primary-foreground' : 'bg-secondary'}`}><p className="whitespace-pre-wrap break-words">{message.body}</p><time className="mt-2 block text-[10px] opacity-70">{dateLabel(message.createdAt)}</time></div>) : <p className="text-sm text-muted-foreground">Start the conversation about this booking.</p>}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) send.mutate(); }} className="flex gap-2 border-t border-border p-3">
          <label className="sr-only" htmlFor="message-draft">Message</label>
          <input id="message-draft" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} className="min-h-11 min-w-0 flex-1 border border-input bg-background px-3 text-sm" placeholder="Write a message" />
          <button disabled={!draft.trim() || send.isPending || !selected} className="min-h-11 bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">Send</button>
        </form>
        {send.isError && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{send.error.message}</p>}
      </section>
    </div>}
  </PageIntro>;
}

function EmergencyPage() {
  const { id = '' } = useParams<{ id?: string }>();
  const services = useListServices();
  const [, setLocation] = useLocation();
  const [serviceSlug, setServiceSlug] = useState('');
  const [emergencyType, setEmergencyType] = useState('PLUMBING');
  const [problem, setProblem] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['marketplace', 'emergency', id],
    queryFn: () => apiFetch<{ requestId: string; type: string; status: string; bookingStatus: string | null; location: string; tracking: { latitude: number; longitude: number; updatedAt: string } | null; safetyNotice: string }>(`/emergency/requests/${id}`),
    enabled: Boolean(id),
    refetchInterval: 5000,
  });
  const create = useMutation({
    mutationFn: () => apiFetch<{ requestId: string }>(`/emergency/requests`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        serviceSlug,
        emergencyType,
        problem,
        description,
        address,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
        safetyAcknowledged,
      }),
    }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['marketplace', 'emergency'] });
      setLocation(`/emergency/${result.requestId}`);
    },
  });
  const locate = () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('This browser does not support location access. Enter a precise address instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords: point }) => setCoordinates({ latitude: point.latitude, longitude: point.longitude }),
      (error) => setLocationError(error.message || 'Location access was not granted.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  const serviceRows = Array.isArray(services.data) ? services.data : [];
  if (id) return <PageIntro eyebrow="Urgent dispatch" title="Emergency request" detail="Dispatch status is updated by the assigned provider and is not a substitute for emergency authorities.">
    {status.isLoading ? <LoadingBlock lines={3} /> : status.isError ? <ErrorBlock retry={() => status.refetch()} /> : status.data ? <div className="max-w-2xl border border-border bg-card p-5"><p className="text-sm font-bold">Dispatch status: {titleCase(status.data.status)}</p><p className="mt-2 text-sm text-muted-foreground">Booking status: {status.data.bookingStatus ? titleCase(status.data.bookingStatus) : 'Waiting for provider acceptance'}</p><p className="mt-3 text-sm">{status.data.location}</p>{status.data.tracking && <p className="mt-3 text-xs text-muted-foreground">Provider location updated {dateLabel(status.data.tracking.updatedAt)} · {status.data.tracking.latitude.toFixed(5)}, {status.data.tracking.longitude.toFixed(5)}</p>}<p className="mt-4 border-t border-border pt-3 text-xs text-destructive">{status.data.safetyNotice}</p></div> : null}
  </PageIntro>;
  return <PageIntro eyebrow="Urgent dispatch" title="Request urgent help" detail="Melse will contact one eligible nearby provider. For immediate danger, fire, serious injury, or risk to life, contact the appropriate local emergency authorities first.">
    <form onSubmit={(event) => { event.preventDefault(); create.mutate(); }} className="max-w-2xl space-y-4 border border-border bg-card p-5">
      <label className="block text-sm font-semibold">Service<select required value={serviceSlug} onChange={(event) => { setServiceSlug(event.target.value); setIdempotencyKey(crypto.randomUUID()); }} className="mt-1 min-h-11 w-full border border-input bg-background px-3"><option value="">Select a service</option>{serviceRows.map((service) => <option key={service.slug} value={service.slug}>{service.name}</option>)}</select></label>
      <label className="block text-sm font-semibold">Emergency type<select value={emergencyType} onChange={(event) => setEmergencyType(event.target.value)} className="mt-1 min-h-11 w-full border border-input bg-background px-3">{[['LOCKSMITH', 'Locked out'], ['PLUMBING', 'Urgent plumbing'], ['ELECTRICAL', 'Electrical issue'], ['ROADSIDE', 'Roadside assistance'], ['OTHER', 'Other']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block text-sm font-semibold">Short description<input required minLength={2} maxLength={200} value={problem} onChange={(event) => setProblem(event.target.value)} className="mt-1 min-h-11 w-full border border-input bg-background px-3" /></label>
      <label className="block text-sm font-semibold">Details<textarea required minLength={5} maxLength={3000} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 min-h-24 w-full border border-input bg-background p-3" /></label>
      <label className="block text-sm font-semibold">Service address<input required minLength={4} maxLength={1000} value={address} onChange={(event) => setAddress(event.target.value)} className="mt-1 min-h-11 w-full border border-input bg-background px-3" /></label>
      <div><button type="button" onClick={locate} className="min-h-10 border border-primary px-4 text-sm font-bold text-primary">Share current location</button><p className="mt-1 text-xs text-muted-foreground">{coordinates ? 'Precise coordinates will only be used for this dispatch.' : 'Location access is optional for standard requests but required for emergency dispatch.'}</p>{locationError && <p role="alert" className="mt-1 text-sm text-destructive">{locationError}</p>}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={safetyAcknowledged} onChange={(event) => setSafetyAcknowledged(event.target.checked)} className="mt-1" /><span>I understand Melse is not an emergency service and will contact local authorities first in immediate danger.</span></label>
      <button disabled={!coordinates || !safetyAcknowledged || create.isPending || services.isLoading} className="min-h-11 bg-destructive px-5 text-sm font-bold text-destructive-foreground disabled:opacity-50">{create.isPending ? 'Contacting eligible provider…' : 'Request emergency dispatch'}</button>
      {create.isError && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
    </form>
  </PageIntro>;
}

function Profile() {
  const { user, updateUser } = useAuth();
  const [, setLocation] = useLocation();
  const services = useListServices();
  const [bio, setBio] = useState('');
  const [experienceYears, setExperienceYears] = useState('0');
  const [serviceArea, setServiceArea] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [providerProfile, setProviderProfile] = useState<{ verificationStatus: string; isAvailable: boolean } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isProvider = user.roles.includes('PROVIDER');

  useEffect(() => {
    if (!isProvider) return;
    let active = true;
    fetch('/api/provider/profile', { credentials: 'same-origin' }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load provider profile.');
      const profile = await response.json();
      if (!active) return;
      setBio(profile.bio ?? '');
      setExperienceYears(String(profile.experienceYears ?? 0));
      setServiceArea(profile.serviceArea ?? '');
      setHourlyRate(profile.hourlyRate ?? '');
      setSelectedServices(profile.services ?? []);
      setProviderProfile({ verificationStatus: profile.verificationStatus, isAvailable: profile.isAvailable });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load provider profile.');
    });
    return () => { active = false; };
  }, [isProvider]);

  const saveProviderProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(isProvider ? '/api/provider/profile' : '/api/provider/activate', {
        method: isProvider ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bio, experienceYears: Number(experienceYears), serviceArea, hourlyRate: hourlyRate || undefined, services: selectedServices }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not save provider profile.');
      await apiFetch('/provider/services', {
        method: 'PUT',
        body: JSON.stringify({
          services: selectedServices.map((categorySlug) => ({
            categorySlug,
            pricingModel: hourlyRate ? 'HOURLY' : 'QUOTE',
            amount: hourlyRate ? Number(hourlyRate) : null,
          })),
        }),
      });
      setProviderProfile({ verificationStatus: body.verificationStatus, isAvailable: body.isAvailable });
      if (!isProvider) updateUser({ ...user, roles: [...new Set([...user.roles, 'PROVIDER'])] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save provider profile.');
    } finally {
      setSaving(false);
    }
  };

  const setAvailability = async (isAvailable: boolean) => {
    setError('');
    try {
      const response = await fetch('/api/provider/profile', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isAvailable }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || 'Could not update availability.');
        return;
      }
      setProviderProfile({ verificationStatus: body.verificationStatus, isAvailable: body.isAvailable });
    } catch {
      setError('Could not reach Melse to update availability.');
    }
  };

  const logout = async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) {
        setError('Could not sign out. Please try again.');
        return;
      }
      setLocation('/auth');
    } catch {
      setError('Could not reach Melse to sign out. Please try again.');
    }
  };

  const serviceOptions = Array.isArray(services.data) ? services.data : [];
  return <PageIntro eyebrow="Account" title="Profile" detail="Your account and provider identity are securely connected to your Melse session.">
    <div className="max-w-xl border border-border bg-card">
      <div className="flex items-center gap-4 border-b border-border p-5"><div className="grid size-14 place-items-center rounded-full bg-primary text-sm font-bold text-accent">{user.fullName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><div><p className="font-bold">{user.fullName}</p><p className="mt-1 text-sm text-muted-foreground">{user.phoneNumber}</p></div></div>
      <div className="divide-y divide-border">
        <DetailLine label="Account roles" value={user.roles.join(' · ')} />
        <DetailLine label="Active mode" value={user.activeMode} />
        <Link href="/support" data-testid="link-profile-support" className="flex items-center justify-between p-4 text-sm font-bold hover:bg-secondary/40">Support and guarantees <ArrowRight size={16} className="text-primary" /></Link>
      </div>
    </div>
    <section className="mt-6 max-w-xl border border-border bg-card p-5">
      <h2 className="font-bold">{isProvider ? 'Provider profile' : 'Become a provider'}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Provider profiles require admin verification before they can appear as available to customers.</p>
      {providerProfile && <p className="mt-3 text-xs font-semibold text-muted-foreground">Verification: {providerProfile.verificationStatus}</p>}
      <form onSubmit={saveProviderProfile} className="mt-4 space-y-4">
        <label className="block text-sm font-semibold">About your work<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={2000} className="mt-2 min-h-20 w-full border border-input bg-background p-3 text-sm" /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold">Experience (years)<input type="number" min="0" max="80" value={experienceYears} onChange={(event) => setExperienceYears(event.target.value)} className="mt-2 h-11 w-full border border-input bg-background px-3" /></label>
          <label className="text-sm font-semibold">Service area<input value={serviceArea} onChange={(event) => setServiceArea(event.target.value)} maxLength={120} className="mt-2 h-11 w-full border border-input bg-background px-3" /></label>
          <label className="text-sm font-semibold">Hourly rate (ETB)<input inputMode="decimal" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} pattern="\\d+(\\.\\d{1,2})?" className="mt-2 h-11 w-full border border-input bg-background px-3" /></label>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">Services and skills</legend>
          {services.isError && <p role="alert" className="mt-2 text-sm text-destructive">Could not load services. Refresh and try again.</p>}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {serviceOptions.map((service) => <label key={service.slug} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedServices.includes(service.slug)} onChange={(event) => setSelectedServices((current) => event.target.checked ? [...current, service.slug] : current.filter((slug) => slug !== service.slug))} />{service.name}</label>)}
          </div>
        </fieldset>
        {providerProfile && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={providerProfile.isAvailable} disabled={providerProfile.verificationStatus !== 'VERIFIED'} onChange={(event) => void setAvailability(event.target.checked)} />Available for work{providerProfile.verificationStatus !== 'VERIFIED' && <span className="font-normal text-muted-foreground">(after verification)</span>}</label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={saving} className="min-h-11 bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-60">{saving ? 'Saving…' : 'Save provider profile'}</button>
      </form>
    </section>
    <button type="button" onClick={() => void logout()} className="mt-5 border border-border px-4 py-2 text-sm font-semibold">Sign out</button>
  </PageIntro>;
}

function ServiceDirectory() {
  const { language } = useLanguage();
  const services = useListServices();
  const rows = Array.isArray(services.data) ? services.data : [];
  return <PageIntro eyebrow="Service directory" title="Everything we fix" detail="Browse the currently available Melse services.">{services.isLoading ? <LoadingBlock lines={5} /> : services.isError ? <ErrorBlock retry={() => services.refetch()} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((service) => <Link key={service.slug} href={`/request/${service.slug}`} data-testid={`card-directory-${service.slug}`} className="group flex items-center justify-between border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-[4px_4px_0_hsl(var(--accent))]"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-secondary text-primary"><IconFor name={service.icon} size={18} /></span><div><p className="text-sm font-bold">{localized(service.name, language)}</p><p className="mt-1 text-xs text-muted-foreground">{localized(service.description, language)}</p></div></div><ArrowRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></Link>)}</div>}</PageIntro>;
}

function Support() {
  return <PageIntro eyebrow="Melse support" title="How can we help?" detail="A real person from the desk can help with a request, estimate, or guarantee question."><div className="grid max-w-2xl gap-3 md:grid-cols-2"><SupportItem icon={MessageCircle} title="Message the desk" detail="Ask about an active request or booking." /><SupportItem icon={ShieldCheck} title="Guarantee and payment" detail="Your estimate is a range. Confirm the final amount before work begins." /><SupportItem icon={CircleAlert} title="Urgent home issue" detail="For immediate danger, contact local emergency services first." /><SupportItem icon={FileText} title="Request a review" detail="We can help document an issue after a visit." /></div><Link href="/" data-testid="link-support-home" className="mt-6 inline-flex min-h-11 items-center gap-2 border border-primary px-5 text-sm font-bold text-primary">Back to home <ArrowRight size={16} /></Link></PageIntro>;
}

function SupportItem({ icon: SupportIcon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return <div className="border border-border bg-card p-5"><SupportIcon size={19} className="text-primary" /><h2 className="mt-4 text-sm font-bold">{title}</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>;
}

function AuthPage() {
  const [, setLocation] = useLocation();
  const [register, setRegister] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName, phoneNumber, password }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || 'Could not sign you in.');
        return;
      }
      setLocation('/');
      window.location.reload();
    } catch {
      setError('Could not reach Melse. Check your connection and try again.');
    }
  };
  return <div className="mx-auto flex min-h-[70vh] max-w-md items-center"><form onSubmit={submit} className="w-full border border-border bg-card p-6 shadow-sm"><Mark /><h1 className="mt-8 text-3xl font-bold">{register ? 'Create your Melse account' : 'Welcome back'}</h1><p className="mt-2 text-sm text-muted-foreground">Use your Ethiopian phone number to continue.</p>{register && <label className="mt-6 block text-sm font-semibold">Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 h-12 w-full border border-input bg-background px-3 outline-none focus:border-primary" /></label>}<label className="mt-5 block text-sm font-semibold">Phone number<input required inputMode="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="09... or +251..." className="mt-2 h-12 w-full border border-input bg-background px-3 outline-none focus:border-primary" /></label><label className="mt-5 block text-sm font-semibold">Password<input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-12 w-full border border-input bg-background px-3 outline-none focus:border-primary" /></label>{error && <p className="mt-4 text-sm text-destructive">{error}</p>}<button type="submit" className="mt-6 min-h-12 w-full bg-primary px-4 text-sm font-bold text-primary-foreground">{register ? 'Create account' : 'Sign in'}</button><button type="button" onClick={() => setRegister(!register)} className="mt-4 w-full text-sm font-semibold text-primary">{register ? 'Already have an account? Sign in' : 'New to Melse? Create an account'}</button></form></div>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [checking, setChecking] = useState(location !== '/auth');
  const [authenticated, setAuthenticated] = useState(location === '/auth');
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    if (location === '/auth') { setAuthenticated(true); setChecking(false); setUser(null); return; }
    let active = true;
    setChecking(true);
    fetch('/api/auth/me', { credentials: 'same-origin' }).then(async (response) => {
      const body = response.ok ? await response.json() : undefined;
      if (active) {
        setAuthenticated(response.ok);
        setUser(body?.user ?? null);
        setChecking(false);
        if (!response.ok) setLocation('/auth');
      }
    }).catch(() => { if (active) { setAuthenticated(false); setUser(null); setChecking(false); setLocation('/auth'); } });
    return () => { active = false; };
  }, [location, setLocation]);
  if (checking) return <div className="grid min-h-[70vh] place-items-center text-sm text-muted-foreground">Checking your session...</div>;
  return authenticated && user ? <authContext.Provider value={{ user, updateUser: setUser }}>{children}</authContext.Provider> : null;
}

function PageIntro({ eyebrow, title, detail, action, children }: { eyebrow: string; title: string; detail: string; action?: ReactNode; children: ReactNode }) {
  const { language } = useLanguage();
  return <div className="mx-auto max-w-4xl"><div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="mono-font text-[10px] uppercase tracking-[.16em] text-muted-foreground">{localized(eyebrow, language)}</p><h1 className="mt-3 text-4xl font-bold tracking-[-.04em] md:text-5xl">{localized(title, language)}</h1><p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{localized(detail, language)}</p></div>{action}</div>{children}</div>;
}

function TechnicianDashboard() {
  const queryClient = useQueryClient();
  const [locationMessage, setLocationMessage] = useState('');
  const locationShare = useMutation({
    mutationFn: ({ latitude, longitude }: { latitude: number; longitude: number }) => apiFetch('/provider/location', {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude, sharingEnabled: true }),
    }),
    onSuccess: () => setLocationMessage('Location sharing is active for eligible emergency dispatches. Stop sharing at any time.'),
  });
  const stopLocationShare = useMutation({
    mutationFn: () => apiFetch('/provider/location', { method: 'DELETE' }),
    onSuccess: () => setLocationMessage('Location sharing has been stopped.'),
  });
  const requests = useQuery({
    queryKey: ['marketplace', 'provider-requests'],
    queryFn: () => apiFetch<Array<{ id: string; offerId: string; serviceName: string; problem: string; description: string; preferredAt: string | null; urgency: string; budgetMin: number | null; budgetMax: number | null; estimatedPriceMin: number; estimatedPriceMax: number; locationAvailable: boolean; createdAt: string }>>('/provider/requests'),
    refetchInterval: 15000,
  });
  const jobs = useQuery({
    queryKey: ['marketplace', 'provider-bookings'],
    queryFn: () => apiFetch<Array<{ id: string; requestId: string; serviceName: string; problem: string; address: string; status: string; finalPrice: number | null; preferredAt: string | null; createdAt: string }>>('/provider/bookings'),
  });
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const response = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'ACCEPT' | 'DECLINE' }) => apiFetch(`/provider/requests/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        ...(quotes[id] ? { quotedPrice: Number(quotes[id]) } : {}),
      }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['marketplace', 'provider-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['marketplace', 'provider-bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['marketplace', 'conversations'] });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`/bookings/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['marketplace', 'provider-bookings'] }),
  });
  const requestRows = requests.data ?? [];
  const jobRows = jobs.data ?? [];
  const nextProviderStatus: Record<string, string> = {
    ACCEPTED: 'TECHNICIAN_EN_ROUTE',
    TECHNICIAN_EN_ROUTE: 'ARRIVED',
    ARRIVED: 'IN_PROGRESS',
    IN_PROGRESS: 'COMPLETED',
  };
  const shareLocation = () => {
    setLocationMessage('');
    if (!navigator.geolocation) {
      setLocationMessage('This browser does not support location sharing.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => locationShare.mutate({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => setLocationMessage(error.message || 'Location access was not granted.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  return <PageIntro eyebrow="Provider workspace" title="Your jobs" detail="Respond to active offers and update each assigned job as it progresses." action={<Link href="/" data-testid="link-technician-customer" className="inline-flex min-h-10 items-center gap-2 border border-primary px-4 text-xs font-bold text-primary">Customer view <ArrowRight size={15} /></Link>}>
    <div className="mb-5 grid gap-3 sm:grid-cols-2"><Metric label="Offers to review" value={String(requestRows.length)} /><Metric label="Assigned jobs" value={String(jobRows.filter((job) => !['COMPLETED', 'CANCELLED', 'DISPUTED', 'PAID', 'RATED'].includes(job.status)).length)} /></div>
    <div className="mb-7 border border-border bg-secondary/50 p-4"><p className="text-sm font-bold">Emergency location sharing</p><p className="mt-1 text-xs text-muted-foreground">Only share your precise location when you choose. It is used for dispatch eligibility and only shown to an assigned customer while en route or providing service.</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={shareLocation} disabled={locationShare.isPending} className="min-h-10 bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50">Share current location</button><button onClick={() => stopLocationShare.mutate()} disabled={stopLocationShare.isPending} className="min-h-10 border border-border px-4 text-xs font-bold">Stop sharing</button></div>{locationMessage && <p role="status" className="mt-2 text-xs">{locationMessage}</p>}</div>
    <section className="mb-8"><h2 className="mb-3 text-lg font-bold">New offers</h2>{requests.isLoading ? <LoadingBlock lines={3} /> : requests.isError ? <ErrorBlock retry={() => requests.refetch()} /> : requestRows.length ? <div className="space-y-3">{requestRows.map((request) => <article key={request.id} className="border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{request.serviceName}: {request.problem}</p><span className="text-xs text-muted-foreground">{titleCase(request.urgency)}</span></div><p className="mt-2 text-sm text-muted-foreground">{request.description}</p><p className="mt-2 text-xs text-muted-foreground">Estimate {money(request.estimatedPriceMin)}–{money(request.estimatedPriceMax)}{request.budgetMax !== null ? ` · Customer budget up to ${money(request.budgetMax)}` : ''}{request.locationAvailable ? ' · Location provided' : ''}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor={`quote-${request.id}`}>Your total quote in ETB</label><input id={`quote-${request.id}`} type="number" min="0.01" step="0.01" value={quotes[request.id] ?? ''} onChange={(event) => setQuotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Total quote (required for hourly/quote services)" className="min-h-10 min-w-0 flex-1 border border-input bg-background px-3 text-sm" /><button onClick={() => response.mutate({ id: request.id, decision: 'ACCEPT' })} disabled={response.isPending} className="min-h-10 bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">Accept</button><button onClick={() => response.mutate({ id: request.id, decision: 'DECLINE' })} disabled={response.isPending} className="min-h-10 border border-border px-4 text-sm font-bold disabled:opacity-50">Decline</button></div>
    </article>)}</div> : <EmptyBlock title="No active offers" detail="Matching customer requests will appear here while offers remain active." />}</section>
    {response.isError && <p role="alert" className="mb-4 text-sm text-destructive">{response.error.message}</p>}
    <section><h2 className="mb-3 text-lg font-bold">Assigned jobs</h2>{jobs.isLoading ? <LoadingBlock lines={3} /> : jobs.isError ? <ErrorBlock retry={() => jobs.refetch()} /> : jobRows.length ? <div className="divide-y divide-border border border-border bg-card">{jobRows.map((job) => <div key={job.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-bold">{job.serviceName}: {job.problem}</p><p className="mt-1 text-xs text-muted-foreground">{job.address} · {job.finalPrice === null ? 'Price pending' : money(job.finalPrice)}</p><p className="mt-1 text-xs font-semibold">{titleCase(job.status)}</p></div>{nextProviderStatus[job.status] && <button onClick={() => update.mutate({ id: job.id, status: nextProviderStatus[job.status] })} disabled={update.isPending} className="min-h-10 bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50">Mark {titleCase(nextProviderStatus[job.status])}</button>}<Link href={`/booking/${job.id}`} className="inline-flex min-h-10 items-center border border-border px-4 text-xs font-bold">Details</Link></div>)}</div> : <EmptyBlock title="No assigned jobs" detail="Accepted requests and customer-selected bookings will appear here." />}</section>
    {update.isError && <p role="alert" className="mt-4 text-sm text-destructive">{update.error.message}</p>}
  </PageIntro>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border border-border bg-card p-4"><p className="mono-font text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold text-primary">{value}</p></div>;
}

function AdminDashboard() {
  const client = useQueryClient();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => apiFetch<Array<{ id: string; fullName: string; phoneNumber: string; isActive: boolean; roles: string[] }>>('/admin/users') });
  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => apiFetch<Array<{ id: string; fullName: string; phoneNumber: string; verificationStatus: string; isAvailable: boolean }>>('/admin/verifications') });
  const disputes = useQuery({ queryKey: ['admin', 'disputes'], queryFn: () => apiFetch<Array<{ dispute: { id: string; reason: string; description: string; status: string }; customerName: string; providerName: string | null; bookingStatus: string }>>('/admin/disputes') });
  const payouts = useQuery({ queryKey: ['admin', 'payouts'], queryFn: () => apiFetch<Array<{ payout: { id: string; amount: string; status: string }; providerName: string; phoneNumber: string }>>('/admin/payouts') });
  const mutateAndRefresh = async (paths: string[]) => {
    await Promise.all(paths.map((path) => client.invalidateQueries({ queryKey: ['admin', path] })));
  };
  const accountStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiFetch(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
    onSuccess: () => mutateAndRefresh(['users']),
  });
  const role = useMutation({
    mutationFn: ({ id, role, enabled }: { id: string; role: 'CUSTOMER' | 'PROVIDER'; enabled: boolean }) => apiFetch(`/admin/users/${id}/roles`, { method: 'PATCH', body: JSON.stringify({ role, enabled }) }),
    onSuccess: () => mutateAndRefresh(['users', 'providers']),
  });
  const verification = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`/admin/verifications/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => mutateAndRefresh(['providers']),
  });
  const disputeDecision = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`/admin/disputes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolution: status === 'UNDER_REVIEW' ? 'The Melse operations team is reviewing the evidence.' : 'The Melse operations team recorded this resolution.' }),
    }),
    onSuccess: () => mutateAndRefresh(['disputes']),
  });
  const payoutDecision = useMutation({
    mutationFn: ({ id, decision, transferReference, proofUrl }: { id: string; decision: 'COMPLETE' | 'REJECT'; transferReference: string; proofUrl: string }) => apiFetch(`/admin/payouts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        decision,
        note: decision === 'COMPLETE' ? 'Manual bank transfer recorded by an administrator.' : 'Payout request rejected after administrator review.',
        ...(decision === 'COMPLETE' ? { transferReference, proofUrl } : {}),
      }),
    }),
    onSuccess: () => mutateAndRefresh(['payouts']),
  });
  const [transfer, setTransfer] = useState<Record<string, { reference: string; proofUrl: string }>>({});
  return <PageIntro eyebrow="Operations workspace" title="Administration" detail="Manage accounts, provider verification, disputes, and manually recorded bank payouts." action={<Link href="/" data-testid="link-admin-customer" className="inline-flex min-h-10 items-center gap-2 border border-primary px-4 text-xs font-bold text-primary">Customer view <ArrowRight size={15} /></Link>}>
    {(users.isError || providers.isError || disputes.isError || payouts.isError) && <p role="alert" className="mb-4 text-sm text-destructive">One or more admin queues could not load. Refresh to try again.</p>}
    {(accountStatus.isError || role.isError || verification.isError || disputeDecision.isError || payoutDecision.isError) && <p role="alert" className="mb-4 text-sm text-destructive">{accountStatus.error?.message || role.error?.message || verification.error?.message || disputeDecision.error?.message || payoutDecision.error?.message}</p>}
    <div className="mb-7 grid gap-3 sm:grid-cols-4"><Metric label="Users" value={String(users.data?.length ?? '—')} /><Metric label="Provider profiles" value={String(providers.data?.length ?? '—')} /><Metric label="Open disputes" value={String(disputes.data?.length ?? '—')} /><Metric label="Pending payouts" value={String(payouts.data?.length ?? '—')} /></div>
    <section className="mb-8"><h2 className="mb-3 text-lg font-bold">Accounts</h2>{users.isLoading ? <LoadingBlock lines={3} /> : <div className="divide-y divide-border border border-border bg-card">{users.data?.map((account) => <div key={account.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="font-bold">{account.fullName}</p><p className="mt-1 text-xs text-muted-foreground">{account.phoneNumber} · {account.roles.join(', ')}</p></div><button onClick={() => role.mutate({ id: account.id, role: 'PROVIDER', enabled: !account.roles.includes('PROVIDER') })} className="min-h-9 border border-border px-3 text-xs font-semibold">{account.roles.includes('PROVIDER') ? 'Remove provider role' : 'Grant provider role'}</button><button onClick={() => accountStatus.mutate({ id: account.id, isActive: !account.isActive })} className="min-h-9 border border-destructive/50 px-3 text-xs font-semibold text-destructive">{account.isActive ? 'Suspend' : 'Reactivate'}</button></div>)}</div>}</section>
    <section className="mb-8"><h2 className="mb-3 text-lg font-bold">Provider verification</h2>{providers.isLoading ? <LoadingBlock lines={3} /> : <div className="divide-y divide-border border border-border bg-card">{providers.data?.map((provider) => <div key={provider.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="font-bold">{provider.fullName}</p><p className="mt-1 text-xs text-muted-foreground">{provider.phoneNumber} · {titleCase(provider.verificationStatus)}</p></div>{['UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'].map((status) => <button key={status} onClick={() => verification.mutate({ id: provider.id, status })} disabled={provider.verificationStatus === status} className="min-h-9 border border-border px-3 text-xs font-semibold disabled:opacity-40">{titleCase(status)}</button>)}</div>)}</div>}</section>
    <section className="mb-8"><h2 className="mb-3 text-lg font-bold">Dispute review</h2>{disputes.isLoading ? <LoadingBlock lines={2} /> : disputes.data?.length ? <div className="space-y-3">{disputes.data.map(({ dispute, customerName, providerName }) => <article key={dispute.id} className="border border-border bg-card p-4"><p className="font-bold">{titleCase(dispute.reason)} · {titleCase(dispute.status)}</p><p className="mt-1 text-xs text-muted-foreground">{customerName} / {providerName ?? 'Provider'} · {dispute.description}</p><div className="mt-3 flex flex-wrap gap-2">{[['UNDER_REVIEW', 'Review'], ['RESOLVED_CUSTOMER', 'Resolve for customer'], ['RESOLVED_PROVIDER', 'Resolve for provider'], ['CLOSED', 'Close']].map(([status, label]) => <button key={status} onClick={() => disputeDecision.mutate({ id: dispute.id, status })} disabled={disputeDecision.isPending} className="min-h-9 border border-border px-3 text-xs font-semibold">{label}</button>)}</div></article>)}</div> : <EmptyBlock title="No open disputes" detail="New customer and provider disputes will be shown here." />}</section>
    <section><h2 className="mb-3 text-lg font-bold">Payout requests</h2>{payouts.isLoading ? <LoadingBlock lines={2} /> : payouts.data?.length ? <div className="space-y-3">{payouts.data.map(({ payout, providerName, phoneNumber }) => <article key={payout.id} className="border border-border bg-card p-4"><p className="font-bold">{providerName} · {money(Number(payout.amount))}</p><p className="mt-1 text-xs text-muted-foreground">{phoneNumber} · {payout.status} · Manual bank transfer required</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]"><input aria-label="Bank transfer reference" value={transfer[payout.id]?.reference ?? ''} onChange={(event) => setTransfer((current) => ({ ...current, [payout.id]: { reference: event.target.value, proofUrl: current[payout.id]?.proofUrl ?? '' } }))} placeholder="Transfer reference" className="min-h-10 border border-input bg-background px-3 text-sm" /><input aria-label="Secure transfer proof URL" type="url" value={transfer[payout.id]?.proofUrl ?? ''} onChange={(event) => setTransfer((current) => ({ ...current, [payout.id]: { reference: current[payout.id]?.reference ?? '', proofUrl: event.target.value } }))} placeholder="HTTPS proof URL" className="min-h-10 border border-input bg-background px-3 text-sm" /><button onClick={() => payoutDecision.mutate({ id: payout.id, decision: 'COMPLETE', transferReference: transfer[payout.id]?.reference ?? '', proofUrl: transfer[payout.id]?.proofUrl ?? '' })} className="min-h-10 bg-primary px-3 text-xs font-bold text-primary-foreground">Record transfer</button><button onClick={() => payoutDecision.mutate({ id: payout.id, decision: 'REJECT', transferReference: '', proofUrl: '' })} className="min-h-10 border border-destructive px-3 text-xs font-bold text-destructive">Reject</button></div></article>)}</div> : <EmptyBlock title="No payout requests" detail="Verified provider payout requests will appear here." />}</section>
  </PageIntro>;
}

function Router() {
  const [location] = useLocation();
return <ErrorBoundary resetKey={location}><Switch><Route path="/auth" component={AuthPage} /><Route><AuthGate><Shell><Switch><Route path="/" component={Home} /><Route path="/jobs" component={Jobs} /><Route path="/my-jobs" component={Jobs} /><Route path="/messages" component={Messages} /><Route path="/profile" component={Profile} /><Route path="/support" component={Support} /><Route path="/emergency" component={EmergencyPage} /><Route path="/emergency/:id" component={EmergencyPage} /><Route path="/services" component={ServiceDirectory} /><Route path="/request/:serviceSlug" component={RequestFlow} /><Route path="/technicians/:requestId" component={TechnicianPicker} /><Route path="/job/:id" component={RequestDetails} /><Route path="/jobs/:id" component={RequestDetails} /><Route path="/booking/:id" component={BookingPage} /><Route path="/technician" component={TechnicianDashboard} /><Route path="/admin" component={AdminDashboard} /><Route component={NotFound} /></Switch></Shell></AuthGate></Route></Switch></ErrorBoundary>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('melse-language') as Language) || 'en');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('melse-theme') as Theme) || 'light');

  useEffect(() => {
    localStorage.setItem('melse-language', language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem('melse-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return <languageContext.Provider value={{ language, setLanguage }}><themeContext.Provider value={{ theme, setTheme }}><QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider></themeContext.Provider></languageContext.Provider>;
}

export default App;