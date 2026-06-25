type TabView = "board" | "calendar" | "pending" | "archive";

interface Props {
  view: string;
  pendingCount: number;
  timerOpen: boolean;
  onSelect: (v: TabView) => void;
  onToggleTimer: () => void;
}

const TABS: { key: TabView; label: string; icon: string }[] = [
  { key: "board", label: "看板", icon: "▦" },
  { key: "calendar", label: "日历", icon: "📅" },
  { key: "pending", label: "待定", icon: "📥" },
  { key: "archive", label: "归档", icon: "🗄" },
];

/**
 * Bottom tab bar — phones only (sm:hidden). Mirrors the desktop view switcher
 * plus a 计时 (focus timer) entry that opens the timer modal.
 */
export function MobileTabBar({
  view,
  pendingCount,
  timerOpen,
  onSelect,
  onToggleTimer,
}: Props) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      {TABS.map((t) => {
        const active = !timerOpen && view === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${
              active ? "text-blue-600" : "text-gray-500"
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
            {t.key === "pending" && pendingCount > 0 && (
              <span className="absolute right-1/2 top-1 translate-x-3 rounded-full bg-amber-500 px-1 text-[10px] font-medium leading-tight text-white">
                {pendingCount}
              </span>
            )}
          </button>
        );
      })}
      <button
        onClick={onToggleTimer}
        className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${
          timerOpen ? "text-blue-600" : "text-gray-500"
        }`}
      >
        <span className="text-lg leading-none">⏱</span>
        计时
      </button>
    </nav>
  );
}
