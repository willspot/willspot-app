import { FlagsClient, TokenVerifier, type Db } from "@willspot/common";
import { type BankProvider } from "./providers.js";
export interface UserInfo {
    status: string;
    kycTier: number;
    firstName: string;
    lastName: string;
}
export interface WalletDeps {
    db: Db;
    verifier: TokenVerifier;
    bank: BankProvider;
    users: {
        get(userId: string): Promise<UserInfo>;
    };
    flags: FlagsClient;
    webhookSecret: string;
    /** Enables POST /v1/sandbox/deposits. Refused at startup in production. */
    sandbox: boolean;
    serviceTokens: Record<string, string | undefined>;
    withdrawFeeMinor?: bigint;
    /** Daily NGN withdrawal limit per KYC tier, in kobo. */
    dailyWithdrawLimits?: Record<number, bigint>;
    logger?: boolean;
}
export declare const MIGRATIONS: string;
export declare const DEFAULT_LIMITS: Record<number, bigint>;
export declare function buildWallet(deps: WalletDeps): Promise<import("fastify").FastifyInstance<import("fastify").RawServerDefault, import("node:http").IncomingMessage, import("node:http").ServerResponse<import("node:http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault>>;
