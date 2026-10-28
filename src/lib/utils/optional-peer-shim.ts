// Safe no-op shim for optional peer dependencies in @coinbase/cdp-sdk (@x402/*)
export function toClientEvmSigner(account: unknown) {
  return account;
}

export function registerExactEvmScheme() {
  return undefined;
}

export function registerExactSvmScheme() {
  return undefined;
}

export class UptoEvmScheme {}
export class ExactSvmScheme {}
export class x402Client {}
export default {};
