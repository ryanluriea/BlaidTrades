import { describe, it, expect } from 'vitest';

interface MockBotInstance {
  id: string;
  botId: string;
  status: string | null;
  startedAt: Date | null;
  isPrimaryRunner: boolean;
  jobType: string;
}

function selectPrimaryRunner(instances: MockBotInstance[]): MockBotInstance | undefined {
  const runnerInstances = instances.filter(i => i.jobType === 'RUNNER');
  
  const sortedRunners = runnerInstances.sort((a, b) => {
    const statusPriority = (s: string | null | undefined) => {
      const upper = s?.toUpperCase() || '';
      if (upper === 'RUNNING') return 3;
      if (upper === 'STARTING') return 2;
      if (upper === 'STOPPED') return 1;
      return 0;
    };
    const aPriority = statusPriority(a.status);
    const bPriority = statusPriority(b.status);
    if (aPriority !== bPriority) return bPriority - aPriority;
    const aTime = a.startedAt?.getTime() || 0;
    const bTime = b.startedAt?.getTime() || 0;
    return bTime - aTime;
  });
  
  return sortedRunners[0];
}

describe('Runner Selection Logic', () => {
  const baseBot = { botId: 'bot-1', jobType: 'RUNNER' as const };
  
  it('should prefer RUNNING over STOPPED regardless of isPrimaryRunner flag', () => {
    const instances: MockBotInstance[] = [
      { ...baseBot, id: 'stale-1', status: 'STOPPED', startedAt: new Date('2024-01-01'), isPrimaryRunner: true },
      { ...baseBot, id: 'stale-2', status: 'STOPPED', startedAt: new Date('2024-01-02'), isPrimaryRunner: true },
      { ...baseBot, id: 'active', status: 'RUNNING', startedAt: new Date('2024-01-03'), isPrimaryRunner: false },
    ];
    
    const selected = selectPrimaryRunner(instances);
    expect(selected?.id).toBe('active');
    expect(selected?.status).toBe('RUNNING');
  });
  
  it('should prefer STARTING over STOPPED when no RUNNING instances exist', () => {
    const instances: MockBotInstance[] = [
      { ...baseBot, id: 'stopped', status: 'STOPPED', startedAt: new Date('2024-01-03'), isPrimaryRunner: true },
      { ...baseBot, id: 'starting', status: 'STARTING', startedAt: new Date('2024-01-01'), isPrimaryRunner: false },
    ];
    
    const selected = selectPrimaryRunner(instances);
    expect(selected?.id).toBe('starting');
    expect(selected?.status).toBe('STARTING');
  });
  
  it('should prefer more recent startedAt when status is the same', () => {
    const instances: MockBotInstance[] = [
      { ...baseBot, id: 'older', status: 'RUNNING', startedAt: new Date('2024-01-01'), isPrimaryRunner: true },
      { ...baseBot, id: 'newer', status: 'RUNNING', startedAt: new Date('2024-01-03'), isPrimaryRunner: false },
    ];
    
    const selected = selectPrimaryRunner(instances);
    expect(selected?.id).toBe('newer');
  });
  
  it('should handle null status as lowest priority', () => {
    const instances: MockBotInstance[] = [
      { ...baseBot, id: 'null-status', status: null, startedAt: new Date('2024-01-03'), isPrimaryRunner: true },
      { ...baseBot, id: 'stopped', status: 'STOPPED', startedAt: new Date('2024-01-01'), isPrimaryRunner: false },
    ];
    
    const selected = selectPrimaryRunner(instances);
    expect(selected?.id).toBe('stopped');
  });
  
  it('should return undefined when no RUNNER instances exist', () => {
    const instances: MockBotInstance[] = [
      { ...baseBot, id: 'backtester', jobType: 'BACKTESTER', status: 'RUNNING', startedAt: new Date('2024-01-01'), isPrimaryRunner: false },
    ];
    
    const selected = selectPrimaryRunner(instances);
    expect(selected).toBeUndefined();
  });
  
  it('should handle case-insensitive status comparison', () => {
    const instances: MockBotInstance[] = [
      { ...baseBot, id: 'lower', status: 'stopped', startedAt: new Date('2024-01-03'), isPrimaryRunner: true },
      { ...baseBot, id: 'running', status: 'running', startedAt: new Date('2024-01-01'), isPrimaryRunner: false },
    ];
    
    const selected = selectPrimaryRunner(instances);
    expect(selected?.id).toBe('running');
  });
  
  it('should select the stale-but-marked primary correctly when no RUNNING exists', () => {
    const instances: MockBotInstance[] = [
      { ...baseBot, id: 'stale-old', status: 'STOPPED', startedAt: new Date('2024-01-01'), isPrimaryRunner: true },
      { ...baseBot, id: 'stale-new', status: 'STOPPED', startedAt: new Date('2024-01-03'), isPrimaryRunner: false },
    ];
    
    const selected = selectPrimaryRunner(instances);
    expect(selected?.id).toBe('stale-new');
  });
});
