import type { ActivityQuery } from "@obryth/contracts";

export const defaultActivityPeriod = "30d";
export const activityPeriods = [
  { value: "7d", label: "最近 7 天", days: 7 },
  { value: "30d", label: "最近 30 天", days: 30 },
  { value: "90d", label: "最近 90 天", days: 90 },
  { value: "180d", label: "最近 180 天", days: 180 },
  { value: "recent", label: "最近一年", days: 365 },
] as const;

export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function dateKey(
  value: string | Date,
  timeZone = deviceTimeZone(),
): string {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function activityRange(
  period: string,
  today: string,
  kind: string,
  timeZone: string,
): ActivityQuery {
  const rollingDays = activityPeriods.find(
    (item) => item.value === period,
  )?.days;
  return {
    from: rollingDays ? shiftDay(today, 1 - rollingDays) : `${period}-01-01`,
    to: rollingDays ? shiftDay(today, 1) : `${Number(period) + 1}-01-01`,
    kind: kind === "all" ? null : kind,
    timeZone,
  };
}
export function calendarDays(range: ActivityQuery) {
  const weekday = new Date(`${range.from}T12:00:00Z`).getUTCDay();
  const start = shiftDay(range.from, -((weekday + 6) % 7));
  const end = shiftDay(range.to, -1);
  const lastWeekday = new Date(`${end}T12:00:00Z`).getUTCDay();
  const paddedEnd = shiftDay(end, 6 - ((lastWeekday + 6) % 7));
  const days: string[] = [];
  for (let day = start; day <= paddedEnd; day = shiftDay(day, 1))
    days.push(day);
  return days;
}

export const activityKinds = [
  { value: "all", label: "全部" },
  { value: "memo", label: "随手记" },
  { value: "document", label: "文档" },
  { value: "runbook", label: "执行日志" },
];
