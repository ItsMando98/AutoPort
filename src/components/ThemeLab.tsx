import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowRightLeft,
  BarChart3,
  Brain,
  Briefcase,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState, EmptyRow } from '@/src/components/ui/empty-state';
import {
  api,
  type ThemeAttribution,
  type ThemeDetailResponse,
  type ThemeDiscovery,
  type ThemeListItem,
  type ThemeListResponse,
} from '@/src/lib/api';
import { cn } from '@/src/lib/utils';

const EMPTY_LIST: ThemeListResponse = {
  overview: {
    updatedAt: Date.now(),
    lastRefreshAt: null,
    activeThemeCount: 0,
    stagedThemeCount: 0,
    archivedThemeCount: 0,
    discoveryCount: 0,
    averageExcessReturn: null,
    maxActiveThemes: 10,
    topThemeId: null,
    topThemeName: null,
  },
  themes: [],
  discoveries: [],
};

const EMPTY_DETAIL: ThemeDetailResponse = {
  theme: null,
  sleeve: null,
  benchmark: null,
  brief: null,
  latestSnapshot: null,
  history: [],
  attribution: [],
  discoveries: [],
};

export function ThemeLab() {
  const [list, setList] = useState<ThemeListResponse>(EMPTY_LIST);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThemeDetailResponse>(EMPTY_DETAIL);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const loadList = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    const next = await api.getThemes();
    setList(next ?? EMPTY_LIST);
    setLoading(false);
    setRefreshing(false);
  };

  const loadDetail = async (themeId: string) => {
    const next = await api.getThemeDetail(themeId);
    setDetail(next ?? EMPTY_DETAIL);
  };

  useEffect(() => {
    void loadList(false);
  }, []);

  useEffect(() => {
    const preferred = selectedThemeId && list.themes.some(theme => theme.id === selectedThemeId)
      ? selectedThemeId
      : list.overview.topThemeId ?? list.themes[0]?.id ?? null;
    if (preferred && preferred !== selectedThemeId) {
      setSelectedThemeId(preferred);
    }
    if (!preferred) {
      setDetail(EMPTY_DETAIL);
    }
  }, [list, selectedThemeId]);

  useEffect(() => {
    if (!selectedThemeId) return;
    void loadDetail(selectedThemeId);
  }, [selectedThemeId]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadList(true);
      if (selectedThemeId) void loadDetail(selectedThemeId);
    }, 30_000);
    return () => clearInterval(interval);
  }, [selectedThemeId]);

  const selectedTheme = useMemo(
    () => list.themes.find(theme => theme.id === selectedThemeId) ?? detail.theme ?? null,
    [detail.theme, list.themes, selectedThemeId],
  );

  const topDiscoveries = detail.discoveries.length > 0 ? detail.discoveries : list.discoveries;
  const topAttribution = useMemo(
    () => [...(detail.attribution ?? [])].sort((a, b) => (b.excessContribution ?? -999) - (a.excessContribution ?? -999)).slice(0, 5),
    [detail.attribution],
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    const next = await api.refreshThemes();
    setList(next ?? EMPTY_LIST);
    if (selectedThemeId) {
      const nextDetail = await api.getThemeDetail(selectedThemeId);
      setDetail(nextDetail ?? EMPTY_DETAIL);
    }
    setRefreshing(false);
  };

  const handleRebuild = async () => {
    if (!selectedThemeId) return;
    setRebuilding(true);
    const next = await api.rebuildTheme(selectedThemeId);
    if (next) {
      setDetail(next);
      await loadList(true);
    }
    setRebuilding(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Theme Lab</h2>
          <p className="text-sm text-zinc-400">
            Dynamic research team for predictive sleeves, benchmark-relative portfolios, and theme discovery.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2 border-zinc-700" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            Refresh Themes
          </Button>
          <Button variant="outline" className="gap-2 border-zinc-700" onClick={handleRebuild} disabled={!selectedThemeId || rebuilding}>
            <ArrowRightLeft className={cn('h-4 w-4', rebuilding && 'animate-spin')} />
            Rebuild Sleeve
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          loading={loading && list.themes.length === 0}
          icon={<Briefcase className="h-4 w-4 text-sky-400" />}
          title="Active Sleeves"
          value={String(list.overview.activeThemeCount)}
          detail={`${list.overview.discoveryCount} discoveries tracked`}
        />
        <SummaryCard
          loading={loading && list.themes.length === 0}
          icon={<Target className="h-4 w-4 text-emerald-400" />}
          title="Top Theme"
          value={list.overview.topThemeName ?? '—'}
          detail={selectedTheme?.benchmarkName ?? 'No benchmark selected'}
        />
        <SummaryCard
          loading={loading && list.themes.length === 0}
          icon={<BarChart3 className="h-4 w-4 text-amber-400" />}
          title="Avg Excess Return"
          value={formatPct(list.overview.averageExcessReturn)}
          detail="Against custom sleeve benchmarks"
        />
        <SummaryCard
          loading={loading && list.themes.length === 0}
          icon={<Brain className="h-4 w-4 text-fuchsia-400" />}
          title="Staged"
          value={String(list.overview.stagedThemeCount)}
          detail={`${list.overview.maxActiveThemes} max active sleeves`}
        />
        <SummaryCard
          loading={loading && list.themes.length === 0}
          icon={<Sparkles className="h-4 w-4 text-zinc-300" />}
          title="Last Refresh"
          value={list.overview.lastRefreshAt ? relativeTime(list.overview.lastRefreshAt) : 'n/a'}
          detail={list.overview.archivedThemeCount > 0 ? `${list.overview.archivedThemeCount} archived themes` : 'No archived themes'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_22rem]">
        <Card className="border-zinc-800/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active Theme Queue</CardTitle>
            <CardDescription>Dynamic sleeves ranked by predictive score and benchmark-relative conviction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && list.themes.length === 0 ? (
              <>
                <ThemeCardSkeleton />
                <ThemeCardSkeleton />
                <ThemeCardSkeleton />
              </>
            ) : null}
            {list.themes.map(theme => (
              <button
                key={theme.id}
                onClick={() => setSelectedThemeId(theme.id)}
                className={cn(
                  'w-full rounded-xl border p-3 text-left transition',
                  selectedThemeId === theme.id ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-50">{theme.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{theme.description ?? 'No description available.'}</div>
                  </div>
                  <Badge variant={theme.status === 'active' ? 'success' : theme.status === 'staged' ? 'secondary' : 'outline'}>
                    {theme.status}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                  <span className="rounded-full border border-zinc-800 px-2 py-1">Score {theme.predictiveScore.toFixed(1)}</span>
                  <span className="rounded-full border border-zinc-800 px-2 py-1">{theme.sourceCount} sources</span>
                  <span className="rounded-full border border-zinc-800 px-2 py-1">{theme.benchmarkSymbol ?? '—'} benchmark</span>
                </div>
                {theme.latestSnapshot && (
                  <div className="mt-3 text-xs text-zinc-500">
                    Excess {formatPct(theme.latestSnapshot.excessReturn)} • Hit rate {formatPct(theme.latestSnapshot.hitRate)}
                  </div>
                )}
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-zinc-800/80">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>{selectedTheme?.name ?? 'Theme Detail'}</CardTitle>
                  <CardDescription>{selectedTheme?.description ?? 'Select a sleeve to inspect thesis, members, and benchmark-relative performance.'}</CardDescription>
                </div>
                {selectedTheme && <Badge variant={selectedTheme.status === 'active' ? 'success' : 'secondary'}>{selectedTheme.status}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Benchmark" value={detail.benchmark?.symbol ?? selectedTheme?.benchmarkSymbol ?? '—'} />
                <Metric label="Predictive Score" value={selectedTheme ? selectedTheme.predictiveScore.toFixed(1) : '—'} />
                <Metric label="Total Return" value={formatPct(detail.latestSnapshot?.totalReturn)} />
                <Metric label="Excess Return" value={formatPct(detail.latestSnapshot?.excessReturn)} />
              </div>

              <div className="grid gap-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="text-sm font-semibold text-zinc-50">Research Brief</div>
                  <div className="mt-2 text-sm text-zinc-300 break-words">{detail.brief?.summary ?? selectedTheme?.thesis ?? 'No research brief available yet.'}</div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <InfoBlock title="Catalysts" items={detail.brief?.catalysts ?? []} empty="No catalysts recorded." />
                    <InfoBlock title="Risks" items={detail.brief?.risks ?? []} empty="No risks recorded." icon={<ShieldAlert className="h-4 w-4 text-amber-400" />} />
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="text-sm font-semibold text-zinc-50">Benchmark Thesis</div>
                  <div className="mt-2 text-sm text-zinc-300 break-words">{detail.brief?.benchmarkThesis ?? detail.benchmark?.rationale ?? 'No benchmark rationale recorded.'}</div>
                  <div className="mt-4 text-xs text-zinc-500">
                    Horizon {detail.brief?.horizon ?? selectedTheme?.horizon ?? '3-12 months'} • Confidence {formatPct(detail.brief?.confidence ?? selectedTheme?.confidence ?? null)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70">
                <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-50">Sleeve Members</div>
                <div className="divide-y divide-zinc-900">
                  {detail.sleeve?.members.length ? detail.sleeve.members.map(member => (
                    <div key={member.symbol} className="grid gap-3 px-4 py-3 md:grid-cols-[8rem_6rem_6rem_minmax(0,1fr)] md:items-start">
                      <div>
                        <div className="font-medium text-zinc-50">{member.symbol}</div>
                        <div className="text-xs text-zinc-500">{member.name}</div>
                      </div>
                      <div className="text-sm text-zinc-300">
                        <div>{formatPct(member.weight)}</div>
                        <div className="text-xs text-zinc-500">weight</div>
                      </div>
                      <div className="text-sm text-zinc-300">
                        <div>{formatPct(member.expectedReturn)}</div>
                        <div className="text-xs text-zinc-500">expected</div>
                      </div>
                      <div className="text-sm text-zinc-400">{member.rationale}</div>
                    </div>
                  )) : <EmptyRow label="No sleeve members published yet." />}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Snapshot History" subtitle="Latest benchmark-relative checkpoints">
                  {detail.history.length > 0 ? detail.history.slice(0, 6).map(snapshot => (
                    <div key={snapshot.id}>
                      <HistoryRow
                        title={relativeTime(snapshot.snapshotAt)}
                        value={formatPct(snapshot.excessReturn)}
                        detail={`Sleeve ${formatPct(snapshot.totalReturn)} vs benchmark ${formatPct(snapshot.benchmarkReturn)}`}
                      />
                    </div>
                  )) : <EmptyState label="No snapshots recorded yet." className="rounded-lg bg-transparent px-3 py-6" />}
                </Panel>
                <Panel title="Attribution" subtitle="Largest benchmark-relative contributors">
                  {topAttribution.length > 0 ? topAttribution.map(item => (
                    <div key={item.id}>
                      <AttributionRow item={item} />
                    </div>
                  )) : <EmptyState label="No attribution rows yet." className="rounded-lg bg-transparent px-3 py-6" />}
                </Panel>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-zinc-800/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Discovery Queue</CardTitle>
              <CardDescription>Newest theme discoveries, validation status, and publishing state.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {topDiscoveries.length > 0 ? topDiscoveries.slice(0, 8).map(discovery => (
                <div key={discovery.id}>
                  <DiscoveryCard
                    discovery={discovery}
                    active={discovery.themeId === selectedThemeId}
                    onClick={() => discovery.themeId && setSelectedThemeId(discovery.themeId)}
                  />
                </div>
              )) : <EmptyState label="No discoveries available yet." className="rounded-lg bg-transparent px-3 py-6" />}
            </CardContent>
          </Card>

          <Card className="border-zinc-800/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pipeline Notes</CardTitle>
              <CardDescription>How sleeves are built and tracked.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-zinc-400">
              <div>Theme discovery scans structured research, symbol theses, and catalyst density.</div>
              <div>Asset selection validates investable names, scores evidence, and normalizes weights.</div>
              <div>Each sleeve keeps its own explicit benchmark and virtual-only performance history.</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, title, value, detail, loading }: { icon: ReactNode; title: string; value: string; detail: string; loading?: boolean }) {
  return (
    <Card className="border-zinc-800/80 bg-zinc-950/80">
      <CardContent className="flex items-start justify-between p-5">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</div>
          {loading ? (
            <>
              <Skeleton className="mt-3 h-7 w-20" />
              <Skeleton className="mt-2 h-4 w-28" />
            </>
          ) : (
            <>
              <div className="mt-3 text-2xl font-semibold text-zinc-50">{value}</div>
              <div className="mt-2 text-sm text-zinc-500">{detail}</div>
            </>
          )}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">{icon}</div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-zinc-50">{value}</div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="text-sm font-semibold text-zinc-50">{title}</div>
      <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function HistoryRow({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-200">{title}</div>
        <div className="text-sm font-medium text-zinc-50">{value}</div>
      </div>
      <div className="mt-1 text-xs text-zinc-500">{detail}</div>
    </div>
  );
}

function AttributionRow({ item }: { item: ThemeAttribution }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-zinc-50">{item.symbol}</div>
        <div className="text-sm text-zinc-200">{formatPct(item.excessContribution)}</div>
      </div>
      <div className="mt-1 text-xs text-zinc-500">{item.rationale ?? 'No rationale recorded.'}</div>
    </div>
  );
}

function DiscoveryCard({
  discovery,
  active,
  onClick,
}: {
  discovery: ThemeDiscovery;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border p-3 text-left transition',
        active ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-zinc-50">{discovery.themeName}</div>
        <Badge variant={discovery.status === 'published' ? 'success' : discovery.status === 'validated' ? 'secondary' : 'outline'}>
          {discovery.status}
        </Badge>
      </div>
      <div className="mt-2 text-sm text-zinc-300">{discovery.title}</div>
      <div className="mt-1 text-xs text-zinc-500">{discovery.summary ?? 'No summary available.'}</div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
        <span className="rounded-full border border-zinc-800 px-2 py-1">Score {discovery.predictiveScore.toFixed(1)}</span>
        <span className="rounded-full border border-zinc-800 px-2 py-1">{discovery.validatedAssetCount} assets</span>
        <span className="rounded-full border border-zinc-800 px-2 py-1">{relativeTime(discovery.discoveredAt)}</span>
      </div>
    </button>
  );
}

function InfoBlock({
  title,
  items,
  empty,
  icon,
}: {
  title: string;
  items: string[];
  empty: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-50">
        {icon}
        {title}
      </div>
      <div className="mt-2 space-y-2 text-sm text-zinc-400">
        {items.length > 0 ? items.map(item => <div key={item}>{item}</div>) : <div>{empty}</div>}
      </div>
    </div>
  );
}

function ThemeCardSkeleton() {
  return (
    <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
        </div>
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
    </div>
  );
}

function relativeTime(value: number): string {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}
