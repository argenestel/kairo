/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/montions.json`.
 */
export type Montions = {
  "address": "MonoTs1KRuamxFReiqsMzVt7gFM8bbn3QmEFjMbyazh",
  "metadata": {
    "name": "montions",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Montions: outcome-first binary options with a fully onchain CLOB on Solana"
  },
  "instructions": [
    {
      "name": "addAsset",
      "discriminator": [
        81,
        53,
        134,
        142,
        243,
        73,
        42,
        179
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.symbol"
              }
            ]
          }
        },
        {
          "name": "priceAccount"
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "addAssetArgs"
            }
          }
        }
      ]
    },
    {
      "name": "cancelOrder",
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createMarket",
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset.symbol",
                "account": "asset"
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              },
              {
                "kind": "arg",
                "path": "strike"
              },
              {
                "kind": "arg",
                "path": "expiry"
              }
            ]
          }
        },
        {
          "name": "yesMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "noMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "strike",
          "type": "u64"
        },
        {
          "name": "expiry",
          "type": "i64"
        }
      ]
    },
    {
      "name": "faucet",
      "discriminator": [
        0,
        98,
        59,
        30,
        144,
        142,
        113,
        12
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "collateralMint",
          "writable": true
        },
        {
          "name": "claim",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  97,
                  117,
                  99,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userCollateral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "collateralMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "collateralMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "maker",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initParams"
            }
          }
        }
      ]
    },
    {
      "name": "makerSweep",
      "discriminator": [
        101,
        26,
        59,
        170,
        118,
        30,
        64,
        90
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "maker",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "merge",
      "discriminator": [
        148,
        141,
        236,
        47,
        174,
        126,
        69,
        111
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "qty",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintCollateral",
      "discriminator": [
        40,
        185,
        106,
        138,
        222,
        107,
        192,
        56
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "collateralMint",
          "writable": true
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "placeOrder",
      "discriminator": [
        51,
        194,
        155,
        175,
        109,
        130,
        96,
        106
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "placeArgs"
            }
          }
        }
      ],
      "returns": {
        "defined": {
          "name": "placeResult"
        }
      }
    },
    {
      "name": "redeem",
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "yesQty",
          "type": "u64"
        },
        {
          "name": "noQty",
          "type": "u64"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "refreshQuotes",
      "discriminator": [
        85,
        134,
        141,
        102,
        73,
        52,
        190,
        138
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "asset",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset.symbol",
                "account": "asset"
              }
            ]
          }
        },
        {
          "name": "priceUpdate"
        },
        {
          "name": "maker",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  107,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "resolve",
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "asset",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset.symbol",
                "account": "asset"
              }
            ]
          }
        },
        {
          "name": "priceUpdate",
          "docs": [
            "(the sponsored feed account, or a posted update). Validated in the handler."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "setAsset",
      "discriminator": [
        243,
        216,
        48,
        30,
        63,
        58,
        91,
        239
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  115,
                  115,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset.symbol",
                "account": "asset"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "update",
          "type": {
            "defined": {
              "name": "assetUpdate"
            }
          }
        }
      ]
    },
    {
      "name": "setParams",
      "discriminator": [
        27,
        234,
        178,
        52,
        147,
        2,
        187,
        141
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "update",
          "type": {
            "defined": {
              "name": "paramsUpdate"
            }
          }
        }
      ]
    },
    {
      "name": "split",
      "discriminator": [
        124,
        189,
        27,
        43,
        216,
        40,
        147,
        66
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "qty",
          "type": "u64"
        }
      ]
    },
    {
      "name": "voidMarket",
      "discriminator": [
        243,
        175,
        46,
        124,
        95,
        101,
        39,
        69
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "withdrawFees",
      "discriminator": [
        198,
        212,
        171,
        109,
        144,
        215,
        174,
        89
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "withdrawSeat",
      "discriminator": [
        199,
        134,
        242,
        135,
        228,
        218,
        74,
        15
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "userCollateral",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "asset",
      "discriminator": [
        234,
        180,
        241,
        252,
        139,
        224,
        160,
        8
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "faucetClaim",
      "discriminator": [
        88,
        39,
        189,
        221,
        15,
        215,
        24,
        248
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    }
  ],
  "events": [
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketResolved",
      "discriminator": [
        89,
        67,
        230,
        95,
        143,
        106,
        199,
        202
      ]
    },
    {
      "name": "marketVoided",
      "discriminator": [
        217,
        12,
        138,
        39,
        108,
        75,
        89,
        26
      ]
    },
    {
      "name": "orderCancelled",
      "discriminator": [
        108,
        56,
        128,
        68,
        168,
        113,
        168,
        239
      ]
    },
    {
      "name": "orderPlaced",
      "discriminator": [
        96,
        130,
        204,
        234,
        169,
        219,
        216,
        227
      ]
    },
    {
      "name": "quotesRefreshed",
      "discriminator": [
        38,
        67,
        32,
        19,
        166,
        150,
        60,
        124
      ]
    },
    {
      "name": "redeemed",
      "discriminator": [
        14,
        29,
        183,
        71,
        31,
        165,
        107,
        38
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "badTick",
      "msg": "tick must be in 1..=99"
    },
    {
      "code": 6001,
      "name": "badQty",
      "msg": "quantity out of range"
    },
    {
      "code": 6002,
      "name": "badArgs",
      "msg": "bad side / time-in-force / argument"
    },
    {
      "code": 6003,
      "name": "marketNotOpen",
      "msg": "market is not open"
    },
    {
      "code": 6004,
      "name": "expired",
      "msg": "trading has ended for this market"
    },
    {
      "code": 6005,
      "name": "notExpired",
      "msg": "market has not expired yet"
    },
    {
      "code": 6006,
      "name": "alreadySettled",
      "msg": "market already settled"
    },
    {
      "code": 6007,
      "name": "notSettled",
      "msg": "market is not settled"
    },
    {
      "code": 6008,
      "name": "badExpiry",
      "msg": "expiry outside the allowed window or off the 5-minute grid"
    },
    {
      "code": 6009,
      "name": "badStrike",
      "msg": "strike must be positive and on the asset's strike grid"
    },
    {
      "code": 6010,
      "name": "orderNotOpen",
      "msg": "order not found or not open"
    },
    {
      "code": 6011,
      "name": "notOrderOwner",
      "msg": "caller does not own this order"
    },
    {
      "code": 6012,
      "name": "insufficientCash",
      "msg": "insufficient collateral"
    },
    {
      "code": 6013,
      "name": "insufficientTokens",
      "msg": "insufficient outcome tokens"
    },
    {
      "code": 6014,
      "name": "wouldCross",
      "msg": "POST_ONLY order would cross the book"
    },
    {
      "code": 6015,
      "name": "bookFull",
      "msg": "order book is full for this market"
    },
    {
      "code": 6016,
      "name": "seatsFull",
      "msg": "seat table is full for this market"
    },
    {
      "code": 6017,
      "name": "minFillNotMet",
      "msg": "filled quantity below min_filled"
    },
    {
      "code": 6018,
      "name": "paused",
      "msg": "protocol is paused for new risk"
    },
    {
      "code": 6019,
      "name": "feeTooHigh",
      "msg": "fee too high"
    },
    {
      "code": 6020,
      "name": "assetInactive",
      "msg": "asset is not active"
    },
    {
      "code": 6021,
      "name": "badPriceAccount",
      "msg": "price account is not a valid Pyth PriceUpdateV2"
    },
    {
      "code": 6022,
      "name": "feedMismatch",
      "msg": "price account feed id does not match the asset"
    },
    {
      "code": 6023,
      "name": "priceNotVerified",
      "msg": "price update is not fully verified"
    },
    {
      "code": 6024,
      "name": "priceNotReady",
      "msg": "price is not usable for settlement yet"
    },
    {
      "code": 6025,
      "name": "priceStale",
      "msg": "price is stale"
    },
    {
      "code": 6026,
      "name": "priceTooUncertain",
      "msg": "price confidence interval too wide"
    },
    {
      "code": 6027,
      "name": "voidTooEarly",
      "msg": "void grace period has not elapsed"
    },
    {
      "code": 6028,
      "name": "faucetCooldown",
      "msg": "faucet cooldown active"
    },
    {
      "code": 6029,
      "name": "mathOverflow",
      "msg": "arithmetic overflow"
    },
    {
      "code": 6030,
      "name": "makerDisabled",
      "msg": "maker is disabled"
    },
    {
      "code": 6031,
      "name": "badAccount",
      "msg": "account constraint violated"
    },
    {
      "code": 6032,
      "name": "invariantViolated",
      "msg": "internal invariant violated"
    }
  ],
  "types": [
    {
      "name": "addAssetArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "strikeStep",
            "type": "u64"
          },
          {
            "name": "volBps",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "settleWindow",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "asset",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "symbol",
            "docs": [
              "Ticker, e.g. \"SOL\". PDA seed: `[\"asset\", symbol.as_bytes()]`."
            ],
            "type": "string"
          },
          {
            "name": "feedId",
            "docs": [
              "Pyth price feed id."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "priceAccount",
            "docs": [
              "Canonical Pyth sponsored price account (PriceUpdateV2, shard 0) for quoting and settlement."
            ],
            "type": "pubkey"
          },
          {
            "name": "strikeStep",
            "docs": [
              "Strike grid in 1e-8 USD; every market strike must be a positive multiple of it."
            ],
            "type": "u64"
          },
          {
            "name": "volBps",
            "docs": [
              "Annualised volatility for the maker model, bps (8000 = 80%)."
            ],
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "docs": [
              "Max Pyth confidence / price, bps, accepted for quoting and settlement."
            ],
            "type": "u16"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "settleWindow",
            "docs": [
              "A print is accepted for settlement iff `expiry <= publish_time <= expiry + settle_window`",
              "(or it is provably the first Pythnet print at/after expiry: `prev_publish_time < expiry`)."
            ],
            "type": "i64"
          },
          {
            "name": "marketCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "assetUpdate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "volBps",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "maxConfBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "active",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "settleWindow",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "strikeStep",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "docs": [
              "Collateral mint (devnet: program-owned \"tUSDC\" PDA mint, 6 decimals, faucet-enabled)."
            ],
            "type": "pubkey"
          },
          {
            "name": "maker",
            "docs": [
              "Maker PDA (`[\"maker\"]`): owner of the maker's seat in every market."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Maker treasury token account (`[\"treasury\"]`, authority = maker PDA)."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "Taker fee in bps of taker collateral consumed (<= MAX_FEE_BPS). Makers pay nothing."
            ],
            "type": "u16"
          },
          {
            "name": "paused",
            "docs": [
              "Pauses NEW risk only (place_order that adds exposure, split, create_market, refresh_quotes).",
              "Cancels, merges, withdrawals, resolution and redemption always work."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "collateralBump",
            "type": "u8"
          },
          {
            "name": "makerBump",
            "type": "u8"
          },
          {
            "name": "treasuryBump",
            "type": "u8"
          },
          {
            "name": "faucetAmount",
            "docs": [
              "Faucet mint per claim (base units) and cooldown between claims per wallet (seconds)."
            ],
            "type": "u64"
          },
          {
            "name": "faucetCooldown",
            "type": "i64"
          },
          {
            "name": "marketCount",
            "type": "u64"
          },
          {
            "name": "makerParams",
            "type": {
              "defined": {
                "name": "makerParams"
              }
            }
          }
        ]
      }
    },
    {
      "name": "faucetClaim",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastClaim",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "faucetAmount",
            "type": "u64"
          },
          {
            "name": "faucetCooldown",
            "type": "i64"
          },
          {
            "name": "makerParams",
            "type": {
              "defined": {
                "name": "makerParams"
              }
            }
          }
        ]
      }
    },
    {
      "name": "level",
      "docs": [
        "One price level (FIFO list of resting orders). Indices point into `Market::orders`."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "head",
            "type": "u8"
          },
          {
            "name": "tail",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "makerParams",
      "docs": [
        "Parameters of the protocol market maker (an onchain, model-priced quoter; see `maker_model`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enabled",
            "docs": [
              "Master switch for `refresh_quotes`."
            ],
            "type": "bool"
          },
          {
            "name": "levels",
            "docs": [
              "Price levels posted per side (1..=4)."
            ],
            "type": "u8"
          },
          {
            "name": "levelSpacing",
            "docs": [
              "Ticks between consecutive levels (>= 1)."
            ],
            "type": "u8"
          },
          {
            "name": "minHalfSpread",
            "docs": [
              "Minimum distance in ticks from fair value to the best maker quote on each side (>= 1)."
            ],
            "type": "u8"
          },
          {
            "name": "maxMarketExposure",
            "docs": [
              "Worst-case loss budget per market in collateral base units: the maker never escrows more",
              "than this in one market (resting orders + inventory at risk)."
            ],
            "type": "u64"
          },
          {
            "name": "levelNotional",
            "docs": [
              "Target collateral per level in base units (actual size is clamped by `max_market_exposure`)."
            ],
            "type": "u64"
          },
          {
            "name": "minTte",
            "docs": [
              "Stop quoting when time to expiry is below this many seconds."
            ],
            "type": "i64"
          },
          {
            "name": "maxPriceAge",
            "docs": [
              "Reject Pyth prices older than this many seconds when quoting."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "A binary market: \"is `asset` >= `strike` at `expiry`?\". One YES + one NO = 1 UNIT, always",
        "fully collateralised. PDA: `[\"market\", asset, strike.to_le_bytes(), expiry.to_le_bytes()]`.",
        "",
        "Accounting (all in collateral base units unless noted):",
        "- `vault.amount == Σ seat.cash + Σ seat.locked + pool + fees` after every instruction.",
        "- `yes_total` / `no_total` count every outstanding claim: SPL supply of the YES/NO mint plus",
        "seat-internal `yes + yes_locked` / `no + no_locked`.",
        "- Open: `pool == yes_total * UNIT == no_total * UNIT`."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "yesMint",
            "type": "pubkey"
          },
          {
            "name": "noMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "strike",
            "docs": [
              "Strike in 1e-8 USD."
            ],
            "type": "u64"
          },
          {
            "name": "expiry",
            "docs": [
              "Expiry (unix seconds). Trading allowed while `now < expiry`."
            ],
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "settlePrice",
            "docs": [
              "Settlement price (1e-8 USD) and its Pyth publish time; 0 until resolved."
            ],
            "type": "i64"
          },
          {
            "name": "settlePublishTime",
            "type": "i64"
          },
          {
            "name": "pool",
            "docs": [
              "Collateral backing outstanding YES/NO pairs."
            ],
            "type": "u64"
          },
          {
            "name": "yesTotal",
            "type": "u64"
          },
          {
            "name": "noTotal",
            "type": "u64"
          },
          {
            "name": "fees",
            "docs": [
              "Accrued taker fees (claimable by admin)."
            ],
            "type": "u64"
          },
          {
            "name": "volume",
            "docs": [
              "Contracts traded (sum of fill quantities)."
            ],
            "type": "u64"
          },
          {
            "name": "nextOrderId",
            "docs": [
              "Next order id to assign (starts at 1)."
            ],
            "type": "u64"
          },
          {
            "name": "bidBits",
            "docs": [
              "Occupancy bitmaps: bit t (t in 1..=99) of the 128-bit value `[lo, hi]` is set iff the level",
              "at tick t is non-empty. `bits[0]` holds ticks 0..=63, `bits[1]` holds ticks 64..=127."
            ],
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "askBits",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "status",
            "docs": [
              "STATUS_OPEN / STATUS_RESOLVED / STATUS_VOID."
            ],
            "type": "u8"
          },
          {
            "name": "outcome",
            "docs": [
              "1 = YES won, 0 = NO won (meaningful only when Resolved)."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "yesMintBump",
            "type": "u8"
          },
          {
            "name": "noMintBump",
            "type": "u8"
          },
          {
            "name": "lastTradeTick",
            "docs": [
              "Tick of the most recent fill (0 if none)."
            ],
            "type": "u8"
          },
          {
            "name": "tradeHead",
            "docs": [
              "Next write position in `trades`."
            ],
            "type": "u8"
          },
          {
            "name": "tradeCount",
            "docs": [
              "Total fills ever recorded."
            ],
            "type": "u32"
          },
          {
            "name": "freeHead",
            "docs": [
              "Head of the free list of order slots (NIL if full). Must be initialised by `engine::init`."
            ],
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "bidLevels",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "level"
                  }
                },
                100
              ]
            }
          },
          {
            "name": "askLevels",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "level"
                  }
                },
                100
              ]
            }
          },
          {
            "name": "orders",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "order"
                  }
                },
                64
              ]
            }
          },
          {
            "name": "seats",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "seat"
                  }
                },
                24
              ]
            }
          },
          {
            "name": "trades",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "trade"
                  }
                },
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "strike",
            "type": "u64"
          },
          {
            "name": "expiry",
            "type": "i64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "marketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "yes",
            "type": "bool"
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "publishTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketVoided",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "order",
      "docs": [
        "A resting order. A slot is free iff `id == 0`."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "docs": [
              "Sequential per market, starting at 1. 0 = empty slot."
            ],
            "type": "u64"
          },
          {
            "name": "qty",
            "docs": [
              "Remaining contracts."
            ],
            "type": "u64"
          },
          {
            "name": "ts",
            "docs": [
              "Placement time (unix seconds)."
            ],
            "type": "i64"
          },
          {
            "name": "seat",
            "docs": [
              "Index of the maker's seat in `Market::seats`."
            ],
            "type": "u8"
          },
          {
            "name": "side",
            "docs": [
              "SIDE_BID or SIDE_ASK."
            ],
            "type": "u8"
          },
          {
            "name": "tick",
            "docs": [
              "Limit tick 1..=99."
            ],
            "type": "u8"
          },
          {
            "name": "fromHeld",
            "docs": [
              "1 if the order is backed by held tokens instead of cash:",
              "Ask → escrowed YES (selling YES); Bid → escrowed NO (closing NO, spec A3)."
            ],
            "type": "u8"
          },
          {
            "name": "prev",
            "docs": [
              "Previous / next order in the same level FIFO (NIL = none). When the slot is free, `next`",
              "links the free list."
            ],
            "type": "u8"
          },
          {
            "name": "next",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "orderCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "qty",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "tick",
            "type": "u8"
          },
          {
            "name": "qty",
            "type": "u64"
          },
          {
            "name": "filled",
            "type": "u64"
          },
          {
            "name": "resting",
            "type": "u64"
          },
          {
            "name": "fromHeld",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "paramsUpdate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "faucetAmount",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "faucetCooldown",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "makerParams",
            "type": {
              "option": {
                "defined": {
                  "name": "makerParams"
                }
              }
            }
          },
          {
            "name": "newAdmin",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "placeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "side",
            "docs": [
              "SIDE_BID (buy YES) or SIDE_ASK (sell YES)."
            ],
            "type": "u8"
          },
          {
            "name": "tick",
            "docs": [
              "Limit tick 1..=99."
            ],
            "type": "u8"
          },
          {
            "name": "qty",
            "docs": [
              "Contracts, 1..=MAX_ORDER_QTY."
            ],
            "type": "u64"
          },
          {
            "name": "tif",
            "docs": [
              "TIF_GTC / TIF_IOC / TIF_POST_ONLY."
            ],
            "type": "u8"
          },
          {
            "name": "fromHeld",
            "docs": [
              "Ask: sell YES the caller holds. Bid: close NO the caller holds (spec A3)."
            ],
            "type": "bool"
          },
          {
            "name": "maxFills",
            "docs": [
              "Max resting orders matched or STP-cancelled (0 → DEFAULT_MAX_FILLS)."
            ],
            "type": "u8"
          },
          {
            "name": "minFilled",
            "docs": [
              "Revert unless at least this many contracts fill immediately (slippage / FOK-style guard)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "placeResult",
      "docs": [
        "Returned by `place_order` (Anchor return data) and by the engine."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "docs": [
              "Id of the resting remainder (0 if nothing rests)."
            ],
            "type": "u64"
          },
          {
            "name": "filled",
            "type": "u64"
          },
          {
            "name": "resting",
            "type": "u64"
          },
          {
            "name": "fee",
            "docs": [
              "Taker fee charged (base units)."
            ],
            "type": "u64"
          },
          {
            "name": "cashOut",
            "docs": [
              "Amounts the instruction must push back to the taker's wallet after matching."
            ],
            "type": "u64"
          },
          {
            "name": "yesOut",
            "type": "u64"
          },
          {
            "name": "noOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "quotesRefreshed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "fairTick",
            "type": "u8"
          },
          {
            "name": "quotes",
            "type": "u8"
          },
          {
            "name": "spot",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "redeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "yesQty",
            "type": "u64"
          },
          {
            "name": "noQty",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "seat",
      "docs": [
        "A maker's balances inside one market. A seat is free iff `owner == Pubkey::default()`."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "cash",
            "docs": [
              "Free collateral (withdrawable)."
            ],
            "type": "u64"
          },
          {
            "name": "locked",
            "docs": [
              "Collateral escrowed in resting orders."
            ],
            "type": "u64"
          },
          {
            "name": "yes",
            "docs": [
              "Free YES / NO contracts (withdrawable as SPL tokens)."
            ],
            "type": "u64"
          },
          {
            "name": "no",
            "type": "u64"
          },
          {
            "name": "yesLocked",
            "docs": [
              "YES escrowed in from_held Asks; NO escrowed in from_held Bids."
            ],
            "type": "u64"
          },
          {
            "name": "noLocked",
            "type": "u64"
          },
          {
            "name": "openOrders",
            "type": "u32"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "trade",
      "docs": [
        "One fill, newest at `trade_head - 1` (mod TRADE_RING)."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "qty",
            "type": "u32"
          },
          {
            "name": "tick",
            "type": "u8"
          },
          {
            "name": "takerIsBuyer",
            "docs": [
              "1 if the taker bought YES (lifted an Ask)."
            ],
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          }
        ]
      }
    }
  ]
};
