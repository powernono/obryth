import {
  cloneElement,
  type ComponentProps,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityCalendar } from "react-activity-calendar";
import type { ActivityDay, ActivityQuery } from "@obryth/contracts";
import { calendarDays } from "../../../lib/activity";

// CSS tokens stay opaque and follow Obryth's theme, including native glass.
const colors = Array.from({ length: 5 }, (_, level) => `var(--heat-${level})`);
const theme = { light: colors, dark: colors };
const labels = {
  months: Array.from({ length: 12 }, (_, month) => `${month + 1}月`),
  weekdays: ["日", "一", "二", "三", "四", "五", "六"],
};
const intensity = (saves: number) =>
  saves === 0 ? 0 : saves < 4 ? 1 : saves < 10 ? 2 : saves < 25 ? 3 : 4;

function tipPosition(container: HTMLDivElement, cell: SVGRectElement) {
  const bounds = container.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  return {
    x: Math.max(
      110,
      Math.min(bounds.width - 110, rect.left - bounds.left + rect.width / 2),
    ),
    y: rect.top - bounds.top - 9,
  };
}

export function ActivityHeatmap({
  range,
  days,
  today,
  selected,
  select,
  loaded,
}: {
  range: ActivityQuery;
  days: ActivityDay[];
  today: string;
  selected: string | null;
  select: (day: string) => void;
  loaded: boolean;
}) {
  const calendar = useMemo(() => calendarDays(range), [range.from, range.to]);
  const counts = new Map(days.map((day) => [day.date, day]));
  const dates = calendar.filter((day) => day >= range.from && day < range.to);
  const data = dates.map((date) => ({
    date,
    count: counts.get(date)?.saves ?? 0,
    level: intensity(counts.get(date)?.saves ?? 0),
  }));
  const [focused, setFocused] = useState(today);
  const [size, setSize] = useState(12);
  const [tip, setTip] = useState<{ date: string; x: number; y: number } | null>(
    null,
  );
  const frame = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const compact = dates.length <= 31;
  const gap = compact ? 5 : 3;
  const columns = compact ? dates.length : calendar.length / 7;

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      setSize(
        Math.max(
          12,
          Math.min(
            compact ? 28 : 15,
            Math.floor((element.clientWidth - (compact ? 12 : 32)) / columns) -
              gap,
          ),
        ),
      );
      setTip(null);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [columns, compact, gap]);
  useEffect(() => {
    const scroll = frame.current?.querySelector(
      ".heatmap-scroll, .react-activity-calendar__scroll-container",
    );
    if (!scroll) return;
    const showRecent = () => {
      scroll.scrollLeft = scroll.scrollWidth;
    };
    const observer = new ResizeObserver(showRecent);
    observer.observe(scroll);
    showRecent();
    const trackFocus = () =>
      setTip((current) => {
        const active = document.activeElement;
        const container = frame.current;
        if (
          !current ||
          !container ||
          !(active instanceof SVGRectElement) ||
          !container.contains(active) ||
          active.dataset.date !== current.date
        )
          return null;
        const bounds = container.getBoundingClientRect();
        const rect = active.getBoundingClientRect();
        if (rect.right < bounds.left || rect.left > bounds.right) return null;
        return { date: current.date, ...tipPosition(container, active) };
      });
    scroll.addEventListener("scroll", trackFocus, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", trackFocus);
    };
  }, [range.from, range.to, size, compact]);
  useEffect(() => {
    setFocused((current) =>
      current >= range.from && current < range.to && current <= today
        ? current
        : today >= range.from && today < range.to
          ? today
          : range.from,
    );
    setTip(null);
  }, [range.from, range.to, today]);

  const describe = (day: string) =>
    `${day} · ${counts.get(day)?.saves ?? 0} 次保存 · ${counts.get(day)?.notes ?? 0} 篇笔记`;
  const showTip = (date: string, element: SVGRectElement) => {
    if (frame.current) setTip({ date, ...tipPosition(frame.current, element) });
  };
  const renderDay: NonNullable<
    ComponentProps<typeof ActivityCalendar>["renderBlock"]
  > = (block, activity) => {
    const day = activity.date;
    const disabled = day > today || !loaded;
    return cloneElement(block, {
      className: "heatmap-day",
      role: "button",
      "aria-label": describe(day),
      "aria-pressed": selected === day,
      "aria-current": day === today ? "date" : undefined,
      "aria-disabled": disabled,
      "aria-describedby": tip?.date === day ? tooltipId : undefined,
      tabIndex: focused === day && !disabled ? 0 : -1,
      style: { stroke: "none" },
      onMouseEnter: (event) => {
        if (!disabled) showTip(day, event.currentTarget);
      },
      onMouseLeave: () => setTip(null),
      onFocus: (event) => {
        setFocused(day);
        if (!disabled) showTip(day, event.currentTarget);
      },
      onBlur: () => setTip(null),
      onClick: () => {
        if (!disabled) select(day);
      },
      onKeyDown: (event) => {
        if (disabled) return;
        if (event.key === "Escape") {
          setTip(null);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(day);
          return;
        }
        const moves: Record<string, number> = {
          ArrowLeft: compact ? -1 : -7,
          ArrowRight: compact ? 1 : 7,
          ArrowUp: -1,
          ArrowDown: 1,
        };
        if (
          !(event.key in moves) &&
          event.key !== "Home" &&
          event.key !== "End"
        )
          return;
        event.preventDefault();
        const last = dates.filter((date) => date <= today).length - 1;
        const index = dates.indexOf(day);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : Math.max(0, Math.min(last, index + moves[event.key]));
        frame.current
          ?.querySelector<SVGRectElement>(`[data-date="${dates[next]}"]`)
          ?.focus();
      },
    });
  };
  const stripWidth = data.length * (size + gap) - gap + 8;
  return (
    <>
      <div
        className={`heatmap-frame ${compact ? "heatmap-compact" : ""}`}
        ref={frame}
        role="group"
        aria-label="按日期查看保存活动"
        aria-busy={!loaded}
      >
        {compact ? (
          <div className="heatmap-scroll">
            <svg
              className="heatmap-strip"
              width={stripWidth}
              height={size + 50}
              role="group"
              aria-label="每日保存活动"
            >
              {data.map((activity, index) => {
                const x = 4 + index * (size + gap);
                const monthStart = activity.date.endsWith("-01");
                return (
                  <g key={activity.date}>
                    {(index === 0 || monthStart) && (
                      <text x={x} y={12} className="heatmap-strip-month">
                        {Number(activity.date.slice(5, 7))}月
                      </text>
                    )}
                    {renderDay(
                      <rect
                        x={x}
                        y={24}
                        width={size}
                        height={size}
                        rx={4}
                        ry={4}
                        fill={colors[activity.level]}
                        data-date={activity.date}
                        data-level={activity.level}
                      />,
                      activity,
                    )}
                    {(size >= 20 ||
                      index % 5 === 0 ||
                      index === data.length - 1 ||
                      monthStart) && (
                      <text x={x + size / 2} y={size + 42} textAnchor="middle">
                        {Number(activity.date.slice(8))}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        ) : (
          <ActivityCalendar
            data={data}
            theme={theme}
            blockSize={size}
            blockMargin={3}
            blockRadius={3}
            fontSize={11}
            weekStart={1}
            labels={labels}
            showWeekdayLabels={["mon", "wed", "fri"]}
            showTotalCount={false}
            showColorLegend={false}
            renderBlock={renderDay}
          />
        )}
        {tip && (
          <div
            className="heatmap-tooltip"
            id={tooltipId}
            role="tooltip"
            style={{ left: tip.x, top: tip.y }}
          >
            <strong>
              {counts.get(tip.date)?.saves ?? 0} 次保存
              <span> · {counts.get(tip.date)?.notes ?? 0} 篇笔记</span>
            </strong>
            <time dateTime={tip.date}>
              {tip.date.replaceAll("-", "/")}
              {tip.date === today ? " · 今天" : ""}
            </time>
          </div>
        )}
      </div>
      <div className="heatmap-footer">
        <span className="heatmap-hint">
          {selected ? describe(selected) : "包含自动保存 · 点击日期回看"}
        </span>
        <span
          className="heatmap-legend"
          aria-label="保存次数：0、1至3、4至9、10至24、25次及以上"
        >
          少
          {[0, 1, 2, 3, 4].map((value) => (
            <i key={value} data-level={value} />
          ))}
          多
        </span>
      </div>
    </>
  );
}
