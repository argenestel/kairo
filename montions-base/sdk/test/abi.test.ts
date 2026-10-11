import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionData } from 'viem';
import {
  chainlinkAggregatorAbi,
  chainlinkOracleAbi,
  chainlinkSettlementResolverAbi,
  erc20Abi,
  makerVaultAbi,
  montionsBookAbi,
  priceOracleAbi,
  quoterAbi,
  resolverAbi,
} from '../src/abi/index.js';

describe('public ABI surfaces', () => {
  it('encodes the frozen tuple using whole contract quantities and numeric enums', () => {
    const p = { seriesId: `0x${'ab'.repeat(32)}` as const, side: 1, tick: 61,
      qty: 123n, fromHeld: false, tif: 1, maxFills: 0 };
    const data = encodeFunctionData({ abi: montionsBookAbi, functionName: 'placeOrder', args: [p] });
    expect(decodeFunctionData({ abi: montionsBookAbi, data })).toEqual({ functionName: 'placeOrder', args: [p] });
  });
  it('keeps handwritten vault and ERC20 signatures aligned to SPEC 13', () => {
    const owner = `0x${'12'.repeat(20)}` as const;
    const data = encodeFunctionData({ abi: makerVaultAbi, functionName: 'withdraw', args: [5_000_000n, owner, owner] });
    expect(decodeFunctionData({ abi: makerVaultAbi, data }).args).toEqual([5_000_000n, owner, owner]);
    expect(encodeFunctionData({ abi: makerVaultAbi, functionName: 'redeemSeries', args: [`0x${'ab'.repeat(32)}`] })).toMatch(/^0x/);
    expect(encodeFunctionData({ abi: erc20Abi, functionName: 'faucet' })).toBe('0xde5f72fd');
    expect(encodeFunctionData({ abi: erc20Abi, functionName: 'permit', args: [owner, owner, 1n, 2n, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`] }).slice(0, 10)).toBe('0xd505accf');
  });
  it('exports valid generated view ABIs', () => {
    expect(encodeFunctionData({ abi: quoterAbi, functionName: 'snapshots', args: [0n, 20n] })).toMatch(/^0x/);
    expect(encodeFunctionData({ abi: priceOracleAbi, functionName: 'assetExists', args: [`0x${'00'.repeat(32)}`] })).toMatch(/^0x/);
    expect(encodeFunctionData({ abi: resolverAbi, functionName: 'resolve', args: ['0x', 1000n] })).toMatch(/^0x/);
  });
  it('exports the generated Base Chainlink ABIs', () => {
    const asset = `0x${'11'.repeat(32)}` as const;
    const feed = '0x00000000000000000000000000000000000000f1' as const;
    expect(encodeFunctionData({ abi: chainlinkOracleAbi, functionName: 'latestPrice', args: [asset] })).toMatch(/^0x/);
    expect(encodeFunctionData({ abi: chainlinkOracleAbi, functionName: 'feedOf', args: [asset] })).toMatch(/^0x/);
    expect(encodeFunctionData({ abi: chainlinkSettlementResolverAbi, functionName: 'findRound', args: [feed, 1_700_000_000n] })).toMatch(/^0x/);
    expect(encodeFunctionData({ abi: chainlinkSettlementResolverAbi, functionName: 'record', args: [feed, 1_700_000_000n, 1n] })).toMatch(/^0x/);
    expect(encodeFunctionData({ abi: chainlinkAggregatorAbi, functionName: 'getRoundData', args: [1n] })).toMatch(/^0x/);
  });
});
