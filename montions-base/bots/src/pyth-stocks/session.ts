/** Evaluate Hermes schedule (Mon..Sun; MMDD exceptions) in its IANA timezone, including DST. */
export function marketOpen(schedule: string, now: number): boolean {
  const [zone, week, exceptions = ''] = schedule.split(';');
  if (!zone || !week) throw new Error('Invalid market schedule');
  const fields = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now * 1000));
  const get = (key: string) => fields.find(p => p.type === key)!.value;
  const weekday = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(get('weekday'));
  const day = get('month') + get('day');
  const exception = exceptions.split(',').find(e => e.startsWith(day + '/'))?.split('/')[1];
  const hours = exception ?? week.split(',')[weekday];
  if (hours === 'C') return false;
  if (hours === 'O') return true;
  if (!hours || !/^\d{4}-\d{4}$/.test(hours)) throw new Error('Unsupported market schedule');
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  const parse = (s: string) => Number(s.slice(0,2)) * 60 + Number(s.slice(2));
  const [start,end] = hours.split('-') as [string,string];
  return minute >= parse(start) && minute < parse(end);
}
