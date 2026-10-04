export function safeErrorMessage(error:unknown):string {
  const message=error instanceof Error?error.message:String(error);
  return message.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi,'[RPC endpoint]').slice(0,1200);
}
export async function safeCall<T>(operation:()=>Promise<T>):Promise<T> {
  try {return await operation();} catch(error) {throw new Error(safeErrorMessage(error),{cause:error});}
}
