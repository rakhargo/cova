import { BaseError, ContractFunctionRevertedError } from 'viem';
const messages:Record<string,string>={
  InvalidAmount:'Enter an amount greater than zero.', InsufficientBalance:'Insufficient available Cova balance. Deposit USDG first.',
  InsufficientAvailableBalance:'Insufficient available Cova balance. Reserved funds cannot be spent.',
  InvalidMerchant:'Enter a valid merchant address.',InvalidExpiry:'Choose an expiry in the future.',
  HoldNotActive:'This hold is already settled or does not exist.',UnauthorizedMerchant:'Connect the authorized merchant wallet.',
  NotMerchant:'Connect the authorized merchant wallet.',HoldExpired:'Authorization expired. Release its remaining funds.',
  NotExpired:'This authorization has not expired yet.',HoldNotExpired:'This authorization has not expired yet.',
  CaptureExceedsRemaining:'Capture exceeds the remaining authorization.',ExceedsAuthorization:'Capture exceeds the remaining authorization.',
  ERC20InsufficientAllowance:'Approve the USDG deposit amount first.',ERC20InsufficientBalance:'Insufficient wallet USDG. Obtain test tokens first.',
  AmountTooLarge:'Authorization amount is too large.',UnsupportedTokenTransfer:'USDG transfer could not complete. Check token restrictions or pauses.',
  InvalidToken:'Configured settlement token is invalid.'
};
export function friendlyError(error:unknown):string {
  if(error instanceof BaseError) {
    const reverted=error.walk(e=>e instanceof ContractFunctionRevertedError);
    if(reverted instanceof ContractFunctionRevertedError) return messages[reverted.data?.errorName ?? ''] || 'Transaction reverted. Refresh the hold and check the amount, expiry and wallet permissions.';
    const text=error.message.toLowerCase();
    if(/reject|denied|4001/.test(text)) return 'Wallet request rejected. You can try again when ready.';
    if(/insufficient funds/.test(text)) return 'Insufficient ETH for network fees. Obtain test ETH on the selected network.';
    if(/chain|network/.test(text)) return 'Switch your wallet to the selected Cova network and try again.';
    return 'Could not reach the network or complete this request. Check your connection and try again.';
  }
  if(error instanceof Error) return error.message.length<220?error.message:'Request failed. Refresh and try again.';
  return 'Request failed. Please try again.';
}
