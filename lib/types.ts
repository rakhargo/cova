import type { Address, Hash } from 'viem';
export type Mode = 'customer' | 'merchant';
export type HoldStatus = 0 | 1 | 2 | 3;
export interface Hold {
  id: Hash; customer: Address; merchant: Address; authorizedAmount: bigint; capturedAmount: bigint;
  expiresAt: number; expiresAtRaw?:bigint; status: HoldStatus; referenceId: Hash; description: string;
  customerAvailable?: bigint; captureHashes?: Hash[]; releaseHash?: Hash; createHash?: Hash;
}
export interface TransactionState {
  status: 'idle' | 'awaiting-wallet' | 'submitted' | 'pending' | 'confirmed' | 'failed';
  label: string; hash?: Hash; error?: string; kind?: 'signature'|'transaction';
}
export interface CreateHoldInput { merchant: string; amount: string; expiryMinutes: number; description: string }
export interface CovaController {
  demo: boolean; local: boolean; ready: boolean; configError?: string; readError?: string;
  address?: Address; connected: boolean; wrongChain: boolean; chainName: string; decimals: number;
  available: bigint; reserved: bigint; walletBalance: bigint; allowance: bigint;
  customerHolds: Hold[]; merchantHolds: Hold[]; transaction: TransactionState; busy: boolean; loading: boolean;
  chainTime?: number; protocolVersion: number; supportsSignedAuthorizations: boolean;
  signedAuthorization?:string; receiptHistoryLoading:boolean; receiptHistoryError?:string;
  signAuthorization:(input:CreateHoldInput)=>Promise<void>; submitAuthorization:(json:string)=>Promise<void>; invalidateAuthorizations:()=>Promise<void>;
  connect: () => Promise<void>; disconnect: () => void; switchChain: () => Promise<void>; refresh: () => void;
  approve: (amount: string) => Promise<void>; deposit: (amount: string) => Promise<void>; withdraw: (amount: string) => Promise<void>;
  createHold: (input: CreateHoldInput) => Promise<void>; capture: (id: Hash, amount: string) => Promise<void>;
  release: (id: Hash) => Promise<void>; releaseExpired: (id: Hash) => Promise<void>; resetDemo: () => void;
  explorerTx: (hash: Hash) => string | undefined;
}
