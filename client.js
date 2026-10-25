window.__ModuleLoader__.load({
  id: '@local/dsh-sidebar-usage',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dshTokenUsage';
    const USAGE_URL = '/dsh-usage/api';
    const CLIENT_VERSION = '0.2.1-rc.3';

    const zh = {
      today: '今日',
      balance: '余额',
      total: '累计',
      todayUsage: '今日用量',
      sessionUsage: '本会话 Tokens',
      sessionCost: '预估消费',
      accountBalance: '账户余额',
      totalUsage: '累计用量',
      cacheRead: '缓存命中',
      inputOutput: '输入 / 输出',
      tokensShort: 'Tokens',
      costShort: '消费',
      cacheShort: '缓存',
      notSignedIn: '登录后查看',
      unavailable: '暂不可用',
      loading: '加载中',
      estimateNote: '消费金额按 DeepSeek 公开价格估算，实际扣费以开放平台为准。',
    };

    const en = {
      today: 'Today',
      balance: 'Balance',
      total: 'Total',
      todayUsage: "Today's usage",
      sessionUsage: 'Session tokens',
      sessionCost: 'Est. cost',
      accountBalance: 'Account balance',
      totalUsage: 'Total usage',
      cacheRead: 'Cache hits',
      inputOutput: 'Input / output',
      tokensShort: 'Tokens',
      costShort: 'Cost',
      cacheShort: 'Cache',
      notSignedIn: 'Sign in to view',
      unavailable: 'Unavailable',
      loading: 'Loading',
      estimateNote: 'Cost is estimated from DeepSeek list prices; billing is authoritative.',
    };

    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        getSnapshot() {
          return state;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        set(next) {
          if (next === state) return;
          state = next;
          for (const listener of listeners) listener();
        },
      };
    }

    const usageStore = createStore({ status: 'loading', data: null, error: false });
    const balanceStore = createStore({ status: 'loading', value: null, error: false });

    function useUsage() {
      return React.useSyncExternalStore(usageStore.subscribe, usageStore.getSnapshot, usageStore.getSnapshot);
    }

    function useBalance() {
      return React.useSyncExternalStore(balanceStore.subscribe, balanceStore.getSnapshot, balanceStore.getSnapshot);
    }

    function fullNumber(value) {
      const number = Math.max(0, Number(value) || 0);
      try {
        return number.toLocaleString();
      } catch {
        return String(Math.round(number));
      }
    }

    function shortNumber(value) {
      const number = Math.max(0, Number(value) || 0);
      if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1).replace('.0', '')}B`;
      if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace('.0', '')}M`;
      if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace('.0', '')}K`;
      return String(Math.round(number));
    }

    function cssText(value) {
      return String(value)
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('\n', ' ');
    }

    function costText(value, known) {
      if (!known) return '—';
      const cost = Math.max(0, Number(value) || 0);
      if (cost <= 0) return '¥0.00';
      if (cost < 0.01) return '<¥0.01';
      try {
        return `¥${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } catch {
        return `¥${cost.toFixed(2)}`;
      }
    }

    function costDetailed(value, known) {
      if (!known) return '—';
      const cost = Math.max(0, Number(value) || 0);
      if (cost <= 0) return '¥0.0000';
      if (cost < 0.0001) return '<¥0.0001';
      return `¥${cost.toFixed(4)}`;
    }

    function estimatedCost(value, known, detailed = false) {
      const text = detailed ? costDetailed(value, known) : costText(value, known);
      if (!known) return text;
      return text.startsWith('<') ? text : `≈${text}`;
    }

    function walletText(value) {
      if (value === null || value === undefined || value.status !== 'ready') return null;
      const wallets = [...(value.value ?? []), ...(value.bonusWallets ?? [])];
      const totals = new Map();
      for (const wallet of wallets) {
        const amount = Number(wallet?.balance);
        if (!Number.isFinite(amount)) continue;
        const currency = typeof wallet?.currency === 'string' && wallet.currency !== '' ? wallet.currency : 'CNY';
        totals.set(currency, (totals.get(currency) ?? 0) + amount);
      }
      if (totals.size === 0) return '¥0.00';
      const parts = [];
      for (const [currency, amount] of totals) {
        const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : `${currency} `;
        if (amount < 0.01) {
          parts.push(amount === 0 ? `${symbol}0.00` : `<${symbol}0.01`);
          continue;
        }
        try {
          parts.push(`${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        } catch {
          parts.push(`${symbol}${amount.toFixed(2)}`);
        }
      }
      return parts.join(' + ');
    }

    function accountMetadata() {
      return {
        version: CLIENT_VERSION,
        locale: (() => {
          try {
            return usageContext.locale.getSnapshot().active;
          } catch {
            return 'en';
          }
        })(),
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      };
    }

    function summaryTitle(t, usage, account) {
      const data = usage.data;
      const balance = walletText(account.value);
      const lines = [
        `${t('todayUsage')}: ${data ? `${fullNumber(data.today?.tokens)} tokens · ${estimatedCost(data.today?.cost, data.today?.costKnown !== false)}` : t('unavailable')}`,
        `${t('accountBalance')}: ${balance ?? (account.status === 'signed-out' ? t('notSignedIn') : account.status === 'error' ? t('unavailable') : '—')}`,
        `${t('totalUsage')}: ${data ? `${fullNumber(data.total?.tokens)} tokens` : '—'}`,
      ];
      if (data?.updatedAt) {
        try {
          lines.push(`${new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        } catch {
          // Ignore an environment without locale time formatting.
        }
      }
      lines.push(t('estimateNote'));
      return lines.join('\n');
    }

    const panelStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      boxSizing: 'border-box',
      minWidth: 0,
      padding: '6px 8px',
      borderRadius: 10,
      border: '0.5px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-specific-input-major)',
      boxShadow: 'var(--dsw-elevation-panel)',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 13.3333,
      lineHeight: '18.6667px',
      fontVariantNumeric: 'tabular-nums',
      userSelect: 'none',
      // Let wheel and pointer input reach the session list underneath.
      pointerEvents: 'none',
      position: 'absolute',
      left: 0,
      bottom: 4,
      zIndex: 10,
    };
    const anchorStyle = {
      display: 'block',
      position: 'relative',
      flex: 'none',
      alignSelf: 'flex-start',
      width: 0,
      height: 0,
      pointerEvents: 'none',
    };
    const rowStyle = {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      minWidth: 0,
      whiteSpace: 'nowrap',
    };
    const labelStyle = {
      flex: '0 0 auto',
      color: 'var(--dsw-alias-label-tertiary)',
    };
    const valueStyle = {
      flex: '0 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      color: 'var(--dsw-alias-label-primary)',
      fontWeight: 500,
    };
    const extraStyle = {
      flex: '0 0 auto',
      marginLeft: 'auto',
      color: 'var(--dsw-alias-label-tertiary)',
    };
    const hoverRowStyle = {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 10,
      minWidth: 0,
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 16,
      lineHeight: '21.3333px',
      fontVariantNumeric: 'tabular-nums',
    };
    const hoverLabelStyle = {
      flex: '0 0 auto',
      color: 'var(--dsw-alias-label-tertiary)',
    };
    const hoverValueStyle = {
      minWidth: 0,
      color: 'var(--dsw-alias-label-primary)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    };

    function sessionRowCss(t, data) {
      const rules = [
        // Reserve scroll room so the last sessions can move above the floating summary.
        `[role="tree"][class*="_list"] {
  padding-bottom: 100px !important;
}`,
      ];
      for (const [sessionId, stat] of Object.entries(data?.sessions ?? {})) {
        if (stat === null || stat === undefined || stat.tokens <= 0) continue;
        const known = stat.costKnown !== false;
        const label = `${shortNumber(stat.tokens)} tok · ${known ? estimatedCost(stat.cost, true) : t('unavailable')}`;
        const key = String(sessionId).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        rules.push(`div[data-row-key="session:${key}"] {
  height: 48px !important;
  min-height: 48px;
  box-sizing: border-box;
  position: relative;
  align-items: flex-start !important;
  padding-top: 5px !important;
  padding-bottom: 4px !important;
}`);
        rules.push(`div[data-row-key="session:${key}"]::after {
  content: "${cssText(label)}";
  position: absolute;
  left: calc(26px + var(--dsh-workspace-indent, 0px));
  right: 8px;
  bottom: 4px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
  font-size: 10.6667px;
  font-weight: 400;
  line-height: 13.3333px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}`);
      }
      return rules.join('\n');
    }

    function UsageSummary({ wide, t }) {
      const usage = useUsage();
      const account = useBalance();
      const anchor = React.useRef(null);
      const [panelWidth, setPanelWidth] = React.useState(210);

      React.useLayoutEffect(() => {
        let host = anchor.current?.parentElement;
        for (let depth = 0; host !== null && host !== undefined && depth < 3; depth += 1) {
          if (host.getBoundingClientRect().width > 80) break;
          host = host.parentElement;
        }
        if (host === null || host === undefined) return undefined;
        const measure = () => {
          const width = host.getBoundingClientRect().width;
          if (width > 0) setPanelWidth(Math.max(150, width));
        };
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
        observer?.observe(host);
        window.addEventListener('resize', measure);
        return () => {
          observer?.disconnect();
          window.removeEventListener('resize', measure);
        };
      }, []);

      if (!wide) return h('span', { ref: anchor, style: anchorStyle });

      const data = usage.data;
      const usageUnavailable = usage.status === 'error' && !data;
      const todayTokens = data ? shortNumber(data.today?.tokens) : usageUnavailable ? t('unavailable') : '—';
      const todayCost = data ? estimatedCost(data.today?.cost, data.today?.costKnown !== false) : '—';
      const totalTokens = data ? shortNumber(data.total?.tokens) : '—';
      const balance = walletText(account.value);
      const balanceLabel = balance
        ?? (account.status === 'signed-out' ? t('notSignedIn') : account.status === 'error' ? t('unavailable') : '—');
      const title = summaryTitle(t, usage, account);
      const rowCss = sessionRowCss(t, data);

      return h('span', {
        ref: anchor,
        style: anchorStyle,
        'data-dsh-usage-meter-anchor': '',
      }, [
        h('style', { key: 'rows' }, rowCss),
        h('div', {
          key: 'panel',
          style: { ...panelStyle, width: panelWidth },
          title,
          'aria-label': title.replaceAll('\n', ' · '),
          'data-dsh-usage-meter': 'summary',
        }, [
          h('div', { key: 'today', style: rowStyle }, [
            h('span', { key: 'label', style: labelStyle }, t('today')),
            h('span', { key: 'tokens', style: valueStyle }, data ? `${todayTokens} tok` : todayTokens),
            h('span', { key: 'cost', style: extraStyle }, data ? todayCost : ''),
          ]),
          h('div', { key: 'balance', style: rowStyle }, [
            h('span', { key: 'label', style: labelStyle }, t('balance')),
            h('span', { key: 'value', style: valueStyle }, balanceLabel),
          ]),
          h('div', { key: 'total', style: rowStyle }, [
            h('span', { key: 'label', style: labelStyle }, t('total')),
            h('span', { key: 'value', style: valueStyle }, data ? `${totalTokens} tok` : '—'),
          ]),
        ]),
      ]);
    }

    function SessionUsageHover({ sessionId, t }) {
      const usage = useUsage();
      const stat = usage.data?.sessions?.[sessionId];
      if (!stat || stat.tokens <= 0) return null;
      const known = stat.costKnown !== false;
      return h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          paddingTop: 4,
          marginTop: 4,
          borderTop: '0.5px solid var(--dsw-alias-border-l2)',
          fontVariantNumeric: 'tabular-nums',
        },
        'data-dsh-usage-hover': sessionId,
      }, [
        h('div', { key: 'tokens', style: hoverRowStyle }, [
          h('span', { key: 'label', style: hoverLabelStyle }, t('tokensShort')),
          h('span', { key: 'value', style: hoverValueStyle }, fullNumber(stat.tokens)),
        ]),
        h('div', { key: 'cost', style: hoverRowStyle }, [
          h('span', { key: 'label', style: hoverLabelStyle }, t('costShort')),
          h('span', { key: 'value', style: hoverValueStyle }, known ? estimatedCost(stat.cost, true, true) : t('unavailable')),
        ]),
        h('div', { key: 'cache', style: hoverRowStyle }, [
          h('span', { key: 'label', style: hoverLabelStyle }, t('cacheShort')),
          h('span', { key: 'value', style: hoverValueStyle }, fullNumber(stat.cacheRead)),
        ]),
      ]);
    }

    let usageContext;
    let active = true;
    let usageInFlight = false;
    let balanceInFlight = false;

    async function refreshUsage() {
      if (!active || usageInFlight) return;
      usageInFlight = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(USAGE_URL, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`usage request failed: ${response.status}`);
        const data = await response.json();
        if (data?.ok !== true) throw new Error('usage response was not ready');
        usageStore.set({ status: 'ready', data, error: false });
      } catch (error) {
        if (!active) return;
        const previous = usageStore.getSnapshot();
        usageStore.set({
          status: previous.data ? 'stale' : 'error',
          data: previous.data,
          error: true,
        });
        console.warn('[dsh-usage-meter] usage refresh failed', error);
      } finally {
        window.clearTimeout(timeout);
        usageInFlight = false;
      }
    }

    async function refreshBalance() {
      if (!active || balanceInFlight) return;
      balanceInFlight = true;
      try {
        const account = usageContext?.remote?.account;
        if (account === undefined || typeof account.getBalance !== 'function') {
          throw new Error('account balance API is unavailable');
        }
        const result = await account.getBalance(accountMetadata());
        if (!result?.ok) throw result?.error ?? new Error('account balance read failed');
        if (result.value === null) {
          balanceStore.set({ status: 'signed-out', value: null, error: false });
          return;
        }
        balanceStore.set({ status: 'ready', value: result.value, error: false });
      } catch (error) {
        if (!active) return;
        const previous = balanceStore.getSnapshot();
        balanceStore.set({
          status: previous.value ? 'stale' : 'error',
          value: previous.value,
          error: true,
        });
        console.warn('[dsh-usage-meter] balance refresh failed', error);
      } finally {
        balanceInFlight = false;
      }
    }

    function apply(ctx) {
      usageContext = ctx;
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage meter: dictionaries');

      ctx.effect(() => {
        active = true;
        let stopped = false;
        const kick = () => {
          if (stopped || document.hidden) return;
          refreshUsage();
          refreshBalance();
        };
        const onVisibility = () => {
          if (!document.hidden) kick();
        };
        window.addEventListener('focus', kick);
        document.addEventListener('visibilitychange', onVisibility);
        kick();
        const usageTimer = window.setInterval(() => {
          if (!document.hidden) refreshUsage();
        }, 10_000);
        const balanceTimer = window.setInterval(() => {
          if (!document.hidden) refreshBalance();
        }, 60_000);
        return () => {
          stopped = true;
          active = false;
          window.clearInterval(usageTimer);
          window.clearInterval(balanceTimer);
          window.removeEventListener('focus', kick);
          document.removeEventListener('visibilitychange', onVisibility);
        };
      }, 'usage meter: usage and balance polling');

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-usage-summary',
        order: -100,
        locale: NS,
      }, UsageSummary));

      ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
        name: 'sidebar.session.row.hover',
        id: 'dsh-usage-hover',
        order: 0,
        locale: NS,
      }, SessionUsageHover));
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      apply,
    };
  },
});
