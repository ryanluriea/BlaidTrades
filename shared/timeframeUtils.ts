export function normalizeTimeframe(timeframe: string | null | undefined): string | null {
  if (!timeframe) return null;
  
  const tf = timeframe.toLowerCase().trim();
  
  const minuteMatch = tf.match(/^(\d+)m$/);
  if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1], 10);
    if (minutes >= 1440) {
      const days = Math.floor(minutes / 1440);
      return `${days}d`;
    }
    if (minutes >= 60 && minutes % 60 === 0) {
      const hours = minutes / 60;
      return `${hours}h`;
    }
    return `${minutes}m`;
  }
  
  const hourMatch = tf.match(/^(\d+)h$/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    if (hours >= 24 && hours % 24 === 0) {
      const days = hours / 24;
      return `${days}d`;
    }
    return `${hours}h`;
  }
  
  const dayMatch = tf.match(/^(\d+)d$/);
  if (dayMatch) {
    return timeframe;
  }
  
  const weekMatch = tf.match(/^(\d+)w$/);
  if (weekMatch) {
    return timeframe;
  }
  
  return timeframe;
}
