export interface MarketSessionStatus {
  isWeekday: boolean;
  isOpen: boolean;
  session: 'open' | 'closed';
  timezone: string;
  localTime: string;
  note: string;
}

function getEasternParts(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    localTime: formatter.format(now),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

export function getMarketSessionStatus(now = new Date()): MarketSessionStatus {
  const { weekday, localTime, hour, minute } = getEasternParts(now);
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const totalMinutes = hour * 60 + minute;
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = 16 * 60;
  const isOpen = isWeekday && totalMinutes >= openMinutes && totalMinutes < closeMinutes;

  return {
    isWeekday,
    isOpen,
    session: isOpen ? 'open' : 'closed',
    timezone: 'America/New_York',
    localTime,
    note: isOpen
      ? 'US cash equity session is open.'
      : isWeekday
        ? 'Outside US cash equity hours (09:30-16:00 ET).'
        : 'Weekend - US cash equity session closed.',
  };
}
