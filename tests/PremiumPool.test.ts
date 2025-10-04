import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_INVALID_PREMIUM_RATE = 102;
const ERR_INVALID_DISTRIBUTION_PERIOD = 103;
const ERR_INSUFFICIENT_BALANCE = 104;
const ERR_PREMIUM_ALREADY_CLAIMED = 105;
const ERR_NO_ACTIVE_PREMIUM = 106;
const ERR_INVALID_FARMER_ID = 107;
const ERR_INVALID_BATCH_ID = 108;
const ERR_INVALID_ORACLE_DATA = 109;
const ERR_DISPUTE_IN_PROGRESS = 110;
const ERR_INVALID_STATUS = 111;
const ERR_POOL_NOT_ACTIVE = 112;
const ERR_INVALID_RECIPIENT = 113;
const ERR_TRANSFER_FAILED = 114;
const ERR_INVALID_PENALTY_RATE = 115;
const ERR_INVALID_THRESHOLD = 116;
const ERR_MAX_DEPOSITS_EXCEEDED = 117;
const ERR_INVALID_CURRENCY = 118;
const ERR_AUTHORITY_NOT_SET = 119;
const ERR_INVALID_TIMESTAMP = 120;

interface Deposit {
  amount: bigint;
  timestamp: bigint;
}

interface Premium {
  farmer: string;
  amount: bigint;
  claimed: boolean;
  batchId: bigint;
}

interface Dispute {
  initiator: string;
  reason: string;
  resolved: boolean;
}

interface SaleVerification {
  batchId: bigint;
  verified: boolean;
  price: bigint;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class PremiumPoolMock {
  state: {
    poolActive: boolean;
    totalDeposited: bigint;
    totalDistributed: bigint;
    premiumRate: bigint;
    distributionPeriod: bigint;
    penaltyRate: bigint;
    claimThreshold: bigint;
    maxDeposits: bigint;
    authorityPrincipal: string;
    oracleContract: string | null;
    certificationContract: string | null;
    trackerContract: string | null;
    resolverContract: string | null;
    deposits: Map<string, Deposit>;
    premiums: Map<bigint, Premium>;
    farmerBalances: Map<string, bigint>;
    disputes: Map<bigint, Dispute>;
    salesVerifications: Map<bigint, SaleVerification>;
  } = {
    poolActive: true,
    totalDeposited: 0n,
    totalDistributed: 0n,
    premiumRate: 10n,
    distributionPeriod: 144n,
    penaltyRate: 5n,
    claimThreshold: 100n,
    maxDeposits: 1000000n,
    authorityPrincipal: "ST1TEST",
    oracleContract: null,
    certificationContract: null,
    trackerContract: null,
    resolverContract: null,
    deposits: new Map(),
    premiums: new Map(),
    farmerBalances: new Map(),
    disputes: new Map(),
    salesVerifications: new Map(),
  };
  blockHeight: bigint = 0n;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: bigint; from: string; to: string }> = [];
  events: Array<unknown> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      poolActive: true,
      totalDeposited: 0n,
      totalDistributed: 0n,
      premiumRate: 10n,
      distributionPeriod: 144n,
      penaltyRate: 5n,
      claimThreshold: 100n,
      maxDeposits: 1000000n,
      authorityPrincipal: "ST1TEST",
      oracleContract: null,
      certificationContract: null,
      trackerContract: null,
      resolverContract: null,
      deposits: new Map(),
      premiums: new Map(),
      farmerBalances: new Map(),
      disputes: new Map(),
      salesVerifications: new Map(),
    };
    this.blockHeight = 0n;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
    this.events = [];
  }

  setOracleContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.authorityPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.oracleContract = contract;
    return { ok: true, value: true };
  }

  depositPremium(amount: bigint): Result<bigint> {
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (!this.state.poolActive) return { ok: false, value: ERR_POOL_NOT_ACTIVE };
    const current = this.state.deposits.get(this.caller) || { amount: 0n, timestamp: 0n };
    if (current.amount + amount > this.state.maxDeposits) return { ok: false, value: ERR_MAX_DEPOSITS_EXCEEDED };
    this.stxTransfers.push({ amount, from: this.caller, to: "contract" });
    this.state.deposits.set(this.caller, { amount: current.amount + amount, timestamp: this.blockHeight });
    this.state.totalDeposited += amount;
    this.events.push({ event: "premium-deposited", depositor: this.caller, amount });
    return { ok: true, value: amount };
  }

  verifySale(saleId: bigint, batchId: bigint, price: bigint): Result<boolean> {
    if (this.caller !== this.state.oracleContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (batchId <= 0n) return { ok: false, value: ERR_INVALID_BATCH_ID };
    if (price <= 0n) return { ok: false, value: ERR_INVALID_ORACLE_DATA };
    this.state.salesVerifications.set(saleId, { batchId, verified: true, price });
    this.events.push({ event: "sale-verified", saleId, batchId });
    return { ok: true, value: true };
  }

  calculateAndDistribute(farmer: string, batchId: bigint, saleId: bigint): Result<bigint> {
    const verification = this.state.salesVerifications.get(saleId);
    if (!verification) return { ok: false, value: ERR_NO_ACTIVE_PREMIUM };
    const price = verification.price;
    const premiumAmount = (price * this.state.premiumRate) / 100n;
    if (farmer === this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (batchId <= 0n) return { ok: false, value: ERR_INVALID_BATCH_ID };
    if (price <= 0n) return { ok: false, value: ERR_INVALID_ORACLE_DATA };
    if (!verification.verified) return { ok: false, value: ERR_INVALID_STATUS };
    if (this.state.totalDeposited < premiumAmount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    const premiumId = this.state.totalDistributed + 1n;
    this.state.premiums.set(premiumId, { farmer, amount: premiumAmount, claimed: false, batchId });
    const currentBalance = this.state.farmerBalances.get(farmer) || 0n;
    this.state.farmerBalances.set(farmer, currentBalance + premiumAmount);
    this.state.totalDistributed += premiumAmount;
    this.state.totalDeposited -= premiumAmount;
    this.events.push({ event: "premium-distributed", farmer, amount: premiumAmount, premiumId });
    return { ok: true, value: premiumAmount };
  }

  claimPremium(premiumId: bigint): Result<bigint> {
    const premium = this.state.premiums.get(premiumId);
    if (!premium) return { ok: false, value: ERR_NO_ACTIVE_PREMIUM };
    if (this.caller !== premium.farmer) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (premium.claimed) return { ok: false, value: ERR_PREMIUM_ALREADY_CLAIMED };
    const balance = this.state.farmerBalances.get(premium.farmer) || 0n;
    if (balance < premium.amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.stxTransfers.push({ amount: premium.amount, from: "contract", to: premium.farmer });
    this.state.premiums.set(premiumId, { ...premium, claimed: true });
    this.state.farmerBalances.set(premium.farmer, balance - premium.amount);
    this.events.push({ event: "premium-claimed", farmer: premium.farmer, amount: premium.amount, premiumId });
    return { ok: true, value: premium.amount };
  }

  initiateDispute(premiumId: bigint, reason: string): Result<bigint> {
    const premium = this.state.premiums.get(premiumId);
    if (!premium) return { ok: false, value: ERR_NO_ACTIVE_PREMIUM };
    if (this.caller !== premium.farmer) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (premium.claimed) return { ok: false, value: ERR_PREMIUM_ALREADY_CLAIMED };
    const disputeId = BigInt(this.state.disputes.size + 1);
    this.state.disputes.set(disputeId, { initiator: this.caller, reason, resolved: false });
    this.events.push({ event: "dispute-initiated", premiumId, disputeId });
    return { ok: true, value: disputeId };
  }

  resolveDispute(disputeId: bigint, resolveInFavor: boolean): Result<boolean> {
    const dispute = this.state.disputes.get(disputeId);
    if (!dispute) return { ok: false, value: ERR_NO_ACTIVE_PREMIUM };
    if (this.caller !== this.state.authorityPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (dispute.resolved) return { ok: false, value: ERR_INVALID_STATUS };
    this.state.disputes.set(disputeId, { ...dispute, resolved: true });
    this.events.push({ event: "dispute-resolved", disputeId, inFavor: resolveInFavor });
    return { ok: true, value: true };
  }

  getPoolStats(): { active: boolean; totalDeposited: bigint; totalDistributed: bigint } {
    return { active: this.state.poolActive, totalDeposited: this.state.totalDeposited, totalDistributed: this.state.totalDistributed };
  }

  getFarmerBalance(farmer: string): bigint {
    return this.state.farmerBalances.get(farmer) || 0n;
  }
}

describe("PremiumPool", () => {
  let contract: PremiumPoolMock;

  beforeEach(() => {
    contract = new PremiumPoolMock();
    contract.reset();
  });

  it("deposits premium successfully", () => {
    const result = contract.depositPremium(1000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000n);
    expect(contract.state.totalDeposited).toBe(1000n);
    expect(contract.stxTransfers).toEqual([{ amount: 1000n, from: "ST1TEST", to: "contract" }]);
  });

  it("rejects invalid deposit amount", () => {
    const result = contract.depositPremium(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects deposit when pool inactive", () => {
    contract.state.poolActive = false;
    const result = contract.depositPremium(1000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_POOL_NOT_ACTIVE);
  });

  it("verifies sale successfully", () => {
    contract.setOracleContract("ST2ORACLE");
    contract.caller = "ST2ORACLE";
    const result = contract.verifySale(1n, 10n, 5000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const verification = contract.state.salesVerifications.get(1n);
    expect(verification?.verified).toBe(true);
    expect(verification?.price).toBe(5000n);
  });

  it("rejects unauthorized sale verification", () => {
    const result = contract.verifySale(1n, 10n, 5000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects distribution with insufficient balance", () => {
    contract.state.salesVerifications.set(1n, { batchId: 10n, verified: true, price: 10000n });
    contract.state.totalDeposited = 50n;
    const result = contract.calculateAndDistribute("ST3FARMER", 10n, 1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("claims premium successfully", () => {
    contract.state.premiums.set(1n, { farmer: "ST1TEST", amount: 100n, claimed: false, batchId: 10n });
    contract.state.farmerBalances.set("ST1TEST", 100n);
    const result = contract.claimPremium(1n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(100n);
    const premium = contract.state.premiums.get(1n);
    expect(premium?.claimed).toBe(true);
    expect(contract.getFarmerBalance("ST1TEST")).toBe(0n);
    expect(contract.stxTransfers).toEqual([{ amount: 100n, from: "contract", to: "ST1TEST" }]);
  });

  it("rejects claim by unauthorized user", () => {
    contract.state.premiums.set(1n, { farmer: "ST3FARMER", amount: 100n, claimed: false, batchId: 10n });
    const result = contract.claimPremium(1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("initiates dispute successfully", () => {
    contract.state.premiums.set(1n, { farmer: "ST1TEST", amount: 100n, claimed: false, batchId: 10n });
    const result = contract.initiateDispute(1n, "Invalid sale");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1n);
    const dispute = contract.state.disputes.get(1n);
    expect(dispute?.resolved).toBe(false);
  });

  it("rejects dispute initiation after claim", () => {
    contract.state.premiums.set(1n, { farmer: "ST1TEST", amount: 100n, claimed: true, batchId: 10n });
    const result = contract.initiateDispute(1n, "Invalid sale");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PREMIUM_ALREADY_CLAIMED);
  });

  it("resolves dispute successfully", () => {
    contract.state.disputes.set(1n, { initiator: "ST1TEST", reason: "Invalid", resolved: false });
    const result = contract.resolveDispute(1n, true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const dispute = contract.state.disputes.get(1n);
    expect(dispute?.resolved).toBe(true);
  });

  it("rejects dispute resolution by unauthorized", () => {
    contract.state.disputes.set(1n, { initiator: "ST1TEST", reason: "Invalid", resolved: false });
    contract.caller = "ST3FAKE";
    const result = contract.resolveDispute(1n, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("gets pool stats correctly", () => {
    contract.state.totalDeposited = 1000n;
    contract.state.totalDistributed = 200n;
    const stats = contract.getPoolStats();
    expect(stats.active).toBe(true);
    expect(stats.totalDeposited).toBe(1000n);
    expect(stats.totalDistributed).toBe(200n);
  });
});