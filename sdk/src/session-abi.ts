// Generated from CovaSessionRouter.sol. Run forge build --root contracts && npm run abi.
export const sessionRouterAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "vault_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "MAX_PAGE_SIZE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "activeSessionCount",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expireSession",
    "inputs": [
      {
        "name": "sessionId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getCustomerSessionIds",
    "inputs": [
      {
        "name": "customer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "offset",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getProviderSessionIds",
    "inputs": [
      {
        "name": "provider",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "offset",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteDigest",
    "inputs": [
      {
        "name": "quote",
        "type": "tuple",
        "internalType": "struct CovaSessionRouter.SessionQuote",
        "components": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "customer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "provider",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "serviceId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "ratePerMinute",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxDurationSeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "startBy",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "holdExpiresAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessions",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum CovaSessionRouter.SessionStatus"
      },
      {
        "name": "quoteDigest",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "holdId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "customer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "provider",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "ratePerMinute",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "maxAmount",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "chargedAmount",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "returnedAmount",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "maxDurationSeconds",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "startedAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "stoppedAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "settleAtMaxDuration",
    "inputs": [
      {
        "name": "sessionId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "startSession",
    "inputs": [
      {
        "name": "quote",
        "type": "tuple",
        "internalType": "struct CovaSessionRouter.SessionQuote",
        "components": [
          {
            "name": "sessionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "customer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "provider",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "serviceId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "ratePerMinute",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxDurationSeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "startBy",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "holdExpiresAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "providerSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "authorization",
        "type": "tuple",
        "internalType": "struct CovaVault.HoldAuthorization",
        "components": [
          {
            "name": "customer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "merchant",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "maxAmount",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "referenceId",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "customerSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "holdId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "stopSession",
    "inputs": [
      {
        "name": "sessionId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "stopSessionWithSignature",
    "inputs": [
      {
        "name": "sessionId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "validUntil",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "customerSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "token",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract CovaVault"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SessionExpired",
    "inputs": [
      {
        "name": "sessionId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "returnedAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SessionSettled",
    "inputs": [
      {
        "name": "sessionId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "stoppedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "billedSeconds",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "chargedAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "returnedAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SessionStarted",
    "inputs": [
      {
        "name": "sessionId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "holdId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "customer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "provider",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "HoldNotExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAuthorization",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProviderSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidQuote",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidStopSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidToken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MaxDurationNotReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PageSizeTooLarge",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SessionAlreadyExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SessionNotActive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StartDeadlinePassed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StopSignatureExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnauthorizedStopper",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnsupportedTokenTransfer",
    "inputs": []
  }
] as const;
