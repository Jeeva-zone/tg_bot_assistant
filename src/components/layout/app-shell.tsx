"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  KeyRound,
  LayoutDashboard,
  Rocket,
  ShieldCheck,
  ShieldAlert,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCredentials } from "@/store/useCredentials";
import { useBuilder } from "@/store/useBuilder";
import { compileProject } from "@/lib/compiler";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/setup", label: "Credentials", icon: KeyRound, exact: false },
  { href: "/builder", label: "Bot Builder", icon: Bot, exact: false },
  { href: "/deploy", label: "Deploy", icon: Rocket, exact: false },
  { href: "/analytics", label: "Analytics & Logs", icon: BarChart3, exact: false },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Compact indicator of whether usable credentials are present. */
function CredentialStatus() {
  const status = useCredentials((state) => state.status);
  const credentials = useCredentials((state) => state.credentials);
  const hydrated = useCredentials((state) => state.hydrated);

  if (!hydrated) {
    return <div className="h-9 animate-pulse rounded-md bg-muted" />;
  }

  if (status === "unlocked" && credentials) {
    return (
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-success" />
          <span className="text-xs font-medium">Connected</span>
        </div>
        <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground">
          @{credentials.telegram.botUsername}
        </p>
        <Badge
          variant={credentials.telebothost.keyType === "secret" ? "success" : "warning"}
          className="mt-2"
        >
          {credentials.telebothost.keyType === "secret" ? "sk_ write key" : "read-only key"}
        </Badge>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-warning" />
        <span className="text-xs font-medium">Not connected</span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {status === "locked" ? "Vault could not be unlocked." : "Add your credentials to deploy."}
      </p>
      <Button asChild size="sm" className="mt-2.5 w-full">
        <Link href="/setup">Set up</Link>
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const hydrateCredentials = useCredentials((state) => state.load);
  const hydrateBuilder = useBuilder((state) => state.hydrate);
  const project = useBuilder((state) => state.project);

  // Hydrate both stores once, on mount. The builder store guards against
  // double-hydration internally.
  React.useEffect(() => {
    void hydrateCredentials();
    hydrateBuilder();
  }, [hydrateCredentials, hydrateBuilder]);

  // Close the mobile drawer whenever the route changes.
  const pathname = usePathname();
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const compiled = React.useMemo(() => compileProject(project), [project]);

  return (
    <div className="min-h-dvh bg-background">
      {/* ---- Mobile top bar ---- */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <Bot className="size-5 text-primary" />
          <span className="text-sm font-semibold">TeleBot Builder</span>
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </Button>
      </header>

      {mobileOpen && (
        <div className="sticky top-[57px] z-30 border-b bg-background p-4 lg:hidden">
          <NavLinks onNavigate={() => setMobileOpen(false)} />
          <div className="mt-4">
            <CredentialStatus />
          </div>
        </div>
      )}

      <div className="flex">
        {/* ---- Desktop sidebar ---- */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-card/40 p-4 lg:flex">
          <Link href="/" className="mb-6 flex items-center gap-2 px-1">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Bot className="size-4.5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">TeleBot Builder</div>
              <div className="text-[11px] text-muted-foreground">TeleBotHost deploy</div>
            </div>
          </Link>

          <NavLinks />

          <div className="mt-6 rounded-lg border bg-card/60 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Activity className="size-3.5 text-primary" />
              Build status
            </div>
            <dl className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              <div className="flex justify-between">
                <dt>Nodes</dt>
                <dd className="font-mono">{compiled.stats.nodeCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt>TBL commands</dt>
                <dd className="font-mono">{compiled.stats.commandCount}</dd>
              </div>
              {compiled.stats.regexRules > 0 && (
                <div className="flex justify-between">
                  <dt>Regex rules</dt>
                  <dd className="font-mono">{compiled.stats.regexRules}</dd>
                </div>
              )}
            </dl>
            {compiled.hasErrors && (
              <Badge variant="destructive" className="mt-2 w-full justify-center">
                {compiled.diagnostics.filter((d) => d.level === "error").length} error(s)
              </Badge>
            )}
          </div>

          <div className="mt-auto pt-4">
            <CredentialStatus />
          </div>
        </aside>

        {/* ---- Main content ---- */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/** Standard page header used across the app. */
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col gap-4 border-b px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="size-4.5 text-primary" />
          </div>
        )}
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
