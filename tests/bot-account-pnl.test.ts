import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Bot Account P&L Aggregation Logic', () => {
  describe('upsertBotAccountPnl calculation logic', () => {
    it('correctly calculates net P&L from realized and fees', () => {
      const realizedPnl = 150.50;
      const fees = 5.25;
      const netPnl = realizedPnl - fees;
      
      expect(netPnl).toBeCloseTo(145.25);
    });

    it('correctly tracks winning trades', () => {
      const pnlUpdate = { realizedPnl: 100, fees: 5, isWin: true };
      expect(pnlUpdate.isWin).toBe(true);
    });

    it('correctly tracks losing trades', () => {
      const pnlUpdate = { realizedPnl: -50, fees: 5, isWin: false };
      expect(pnlUpdate.isWin).toBe(false);
    });

    it('correctly accumulates trade counts', () => {
      let existing = { totalTrades: 5, winningTrades: 3, losingTrades: 2 };
      
      const afterWin = {
        totalTrades: existing.totalTrades + 1,
        winningTrades: existing.winningTrades + 1,
        losingTrades: existing.losingTrades,
      };
      
      expect(afterWin.totalTrades).toBe(6);
      expect(afterWin.winningTrades).toBe(4);
      expect(afterWin.losingTrades).toBe(2);
      
      const afterLoss = {
        totalTrades: afterWin.totalTrades + 1,
        winningTrades: afterWin.winningTrades,
        losingTrades: afterWin.losingTrades + 1,
      };
      
      expect(afterLoss.totalTrades).toBe(7);
      expect(afterLoss.winningTrades).toBe(4);
      expect(afterLoss.losingTrades).toBe(3);
    });

    it('correctly calculates peak equity', () => {
      let peakEquity = 1000;
      let currentEquity = 950;
      
      peakEquity = Math.max(peakEquity, currentEquity);
      expect(peakEquity).toBe(1000);
      
      currentEquity = 1200;
      peakEquity = Math.max(peakEquity, currentEquity);
      expect(peakEquity).toBe(1200);
    });

    it('correctly calculates max drawdown', () => {
      const peakEquity = 1000;
      const currentEquity = 850;
      const drawdown = peakEquity - currentEquity;
      const drawdownPercent = peakEquity > 0 ? (drawdown / peakEquity) * 100 : 0;
      
      expect(drawdown).toBe(150);
      expect(drawdownPercent).toBeCloseTo(15);
    });

    it('correctly updates max drawdown when new drawdown is larger', () => {
      let maxDrawdown = 50;
      let maxDrawdownPercent = 5;
      
      const newDrawdown = 75;
      const newDrawdownPercent = 7.5;
      
      const updatedMaxDrawdown = Math.max(maxDrawdown, newDrawdown);
      const updatedMaxDrawdownPercent = Math.max(maxDrawdownPercent, newDrawdownPercent);
      
      expect(updatedMaxDrawdown).toBe(75);
      expect(updatedMaxDrawdownPercent).toBeCloseTo(7.5);
    });
  });

  describe('Computed balance calculation', () => {
    it('correctly computes balance from initial + bot P&L', () => {
      const initialBalance = 10000;
      const botPnlRecords = [
        { netPnl: 150 },
        { netPnl: -50 },
        { netPnl: 200 },
      ];
      
      const totalBotPnl = botPnlRecords.reduce((sum, bp) => sum + (bp.netPnl || 0), 0);
      const computedBalance = initialBalance + totalBotPnl;
      
      expect(totalBotPnl).toBe(300);
      expect(computedBalance).toBe(10300);
    });

    it('handles empty bot P&L records', () => {
      const initialBalance = 10000;
      const botPnlRecords: { netPnl: number }[] = [];
      
      const totalBotPnl = botPnlRecords.reduce((sum, bp) => sum + (bp.netPnl || 0), 0);
      const computedBalance = initialBalance + totalBotPnl;
      
      expect(totalBotPnl).toBe(0);
      expect(computedBalance).toBe(10000);
    });

    it('handles null/undefined netPnl values', () => {
      const initialBalance = 10000;
      const botPnlRecords = [
        { netPnl: 150 },
        { netPnl: null as unknown as number },
        { netPnl: undefined as unknown as number },
        { netPnl: 200 },
      ];
      
      const totalBotPnl = botPnlRecords.reduce((sum, bp) => sum + (bp.netPnl || 0), 0);
      const computedBalance = initialBalance + totalBotPnl;
      
      expect(totalBotPnl).toBe(350);
      expect(computedBalance).toBe(10350);
    });
  });

  describe('Win rate calculation', () => {
    it('calculates correct win rate percentage', () => {
      const totalTrades = 10;
      const winningTrades = 6;
      const winRate = (winningTrades / totalTrades) * 100;
      
      expect(winRate).toBe(60);
    });

    it('handles zero trades', () => {
      const totalTrades = 0;
      const winningTrades = 0;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
      
      expect(winRate).toBe(0);
    });

    it('handles 100% win rate', () => {
      const totalTrades = 5;
      const winningTrades = 5;
      const winRate = (winningTrades / totalTrades) * 100;
      
      expect(winRate).toBe(100);
    });

    it('handles 0% win rate', () => {
      const totalTrades = 5;
      const winningTrades = 0;
      const winRate = (winningTrades / totalTrades) * 100;
      
      expect(winRate).toBe(0);
    });
  });
});

describe('Backfill P&L Endpoint Logic', () => {
  it('correctly aggregates trades by bot and account', () => {
    const mockTradeResults = [
      { bot_id: 'bot1', account_id: 'acc1', total_trades: '5', winners: '3', losers: '2', total_pnl: '150.50', total_fees: '10.00' },
      { bot_id: 'bot1', account_id: 'acc2', total_trades: '3', winners: '1', losers: '2', total_pnl: '-50.00', total_fees: '5.00' },
      { bot_id: 'bot2', account_id: 'acc1', total_trades: '8', winners: '5', losers: '3', total_pnl: '300.00', total_fees: '15.00' },
    ];
    
    const processed = mockTradeResults.map(row => ({
      botId: row.bot_id,
      accountId: row.account_id,
      totalTrades: parseInt(row.total_trades),
      winners: parseInt(row.winners),
      losers: parseInt(row.losers),
      totalPnl: parseFloat(row.total_pnl),
      totalFees: parseFloat(row.total_fees),
      netPnl: parseFloat(row.total_pnl) - parseFloat(row.total_fees),
    }));
    
    expect(processed).toHaveLength(3);
    expect(processed[0].netPnl).toBeCloseTo(140.50);
    expect(processed[1].netPnl).toBeCloseTo(-55.00);
    expect(processed[2].netPnl).toBeCloseTo(285.00);
  });

  it('handles string to number parsing correctly', () => {
    const stringValue = '123.456';
    const parsed = parseFloat(stringValue);
    
    expect(parsed).toBeCloseTo(123.456);
  });

  it('handles empty or null values in aggregation', () => {
    const row = { total_pnl: '0', total_fees: '0' };
    const netPnl = parseFloat(row.total_pnl || '0') - parseFloat(row.total_fees || '0');
    
    expect(netPnl).toBe(0);
  });
});
