/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pixel_pets.json`.
 */
export type PixelPets = {
  "address": "2R4P5J6rwE1F2R8fRRF1dvqV9JxwSTix4Qf6FGhc3iQR",
  "metadata": {
    "name": "pixelPets",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "acceptSwap",
      "discriminator": [
        166,
        173,
        240,
        207,
        167,
        11,
        3,
        20
      ],
      "accounts": [
        {
          "name": "taker",
          "writable": true,
          "signer": true
        },
        {
          "name": "maker",
          "writable": true
        },
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
          "name": "collection",
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset",
          "writable": true,
          "relations": [
            "petRecord"
          ]
        },
        {
          "name": "petRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "desiredAsset",
          "writable": true
        },
        {
          "name": "desiredRecord",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "desiredAsset"
              }
            ]
          }
        },
        {
          "name": "offer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "offer.asset",
                "account": "offer"
              },
              {
                "kind": "account",
                "path": "offer.nonce",
                "account": "offer"
              }
            ]
          }
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "buy",
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "maker",
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
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
          "name": "collection",
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset",
          "writable": true,
          "relations": [
            "petRecord"
          ]
        },
        {
          "name": "petRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "offer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "offer.asset",
                "account": "offer"
              },
              {
                "kind": "account",
                "path": "offer.nonce",
                "account": "offer"
              }
            ]
          }
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "expectedPriceLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancelOffer",
      "discriminator": [
        92,
        203,
        223,
        40,
        92,
        89,
        53,
        119
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "maker",
          "writable": true
        },
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
          "name": "collection",
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset",
          "writable": true,
          "relations": [
            "petRecord"
          ]
        },
        {
          "name": "petRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "offer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "offer.asset",
                "account": "offer"
              },
              {
                "kind": "account",
                "path": "offer.nonce",
                "account": "offer"
              }
            ]
          }
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "checkpoint",
      "discriminator": [
        213,
        200,
        19,
        204,
        240,
        143,
        184,
        252
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "issuer",
          "signer": true,
          "relations": [
            "config"
          ]
        },
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
          "name": "collection",
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset",
          "relations": [
            "petRecord"
          ]
        },
        {
          "name": "petRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "checkpointArgs"
            }
          }
        }
      ]
    },
    {
      "name": "claimPet",
      "discriminator": [
        252,
        72,
        52,
        203,
        49,
        81,
        178,
        176
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "recipient",
          "signer": true
        },
        {
          "name": "issuer",
          "signer": true,
          "relations": [
            "config"
          ]
        },
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
          "name": "edition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  100,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "edition.edition_id",
                "account": "edition"
              }
            ]
          }
        },
        {
          "name": "collection",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset",
          "writable": true,
          "signer": true
        },
        {
          "name": "petRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "arg",
                "path": "claimId"
              }
            ]
          }
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "claimId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "configure",
      "discriminator": [
        245,
        7,
        108,
        117,
        95,
        196,
        54,
        217
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
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
        }
      ],
      "args": [
        {
          "name": "issuer",
          "type": "pubkey"
        },
        {
          "name": "feeRecipient",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "createEdition",
      "discriminator": [
        135,
        127,
        186,
        53,
        236,
        181,
        38,
        199
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
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
          "name": "edition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  100,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "args.edition_id"
              }
            ]
          }
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
              "name": "editionArgs"
            }
          }
        }
      ]
    },
    {
      "name": "createSale",
      "discriminator": [
        137,
        197,
        124,
        245,
        254,
        35,
        17,
        12
      ],
      "accounts": [
        {
          "name": "maker",
          "writable": true,
          "signer": true
        },
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
          "name": "collection",
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset",
          "writable": true,
          "relations": [
            "petRecord"
          ]
        },
        {
          "name": "petRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "offer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        },
        {
          "name": "priceLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createSwap",
      "discriminator": [
        176,
        207,
        238,
        60,
        195,
        2,
        203,
        91
      ],
      "accounts": [
        {
          "name": "maker",
          "writable": true,
          "signer": true
        },
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
          "name": "collection",
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset",
          "writable": true,
          "relations": [
            "petRecord"
          ]
        },
        {
          "name": "petRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "desiredAsset"
        },
        {
          "name": "desiredRecord",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "desiredAsset"
              }
            ]
          }
        },
        {
          "name": "offer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
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
          "name": "admin",
          "writable": true,
          "signer": true
        },
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
          "name": "collection",
          "writable": true,
          "signer": true
        },
        {
          "name": "program",
          "address": "2R4P5J6rwE1F2R8fRRF1dvqV9JxwSTix4Qf6FGhc3iQR"
        },
        {
          "name": "programData"
        },
        {
          "name": "coreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
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
              "name": "initializeArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "baseAssetV1",
      "discriminator": [
        1
      ]
    },
    {
      "name": "baseCollectionV1",
      "discriminator": [
        5
      ]
    },
    {
      "name": "claimReceipt",
      "discriminator": [
        223,
        233,
        11,
        229,
        124,
        165,
        207,
        28
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
      "name": "edition",
      "discriminator": [
        234,
        117,
        249,
        74,
        7,
        99,
        235,
        167
      ]
    },
    {
      "name": "offer",
      "discriminator": [
        215,
        88,
        60,
        71,
        170,
        162,
        73,
        229
      ]
    },
    {
      "name": "petRecord",
      "discriminator": [
        180,
        224,
        209,
        218,
        144,
        104,
        195,
        179
      ]
    }
  ],
  "events": [
    {
      "name": "checkpointRecorded",
      "discriminator": [
        157,
        192,
        91,
        196,
        149,
        33,
        47,
        247
      ]
    },
    {
      "name": "offerCancelled",
      "discriminator": [
        45,
        42,
        175,
        214,
        51,
        192,
        154,
        9
      ]
    },
    {
      "name": "offerOpened",
      "discriminator": [
        51,
        235,
        45,
        64,
        193,
        14,
        119,
        113
      ]
    },
    {
      "name": "offerSettled",
      "discriminator": [
        28,
        72,
        212,
        133,
        229,
        156,
        62,
        254
      ]
    },
    {
      "name": "petClaimed",
      "discriminator": [
        92,
        104,
        18,
        143,
        48,
        95,
        1,
        227
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Protocol is paused; cancellation remains available"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Signer is not authorized"
    },
    {
      "code": 6002,
      "name": "invalidMetadata",
      "msg": "Metadata must have a nonempty short name and content-addressed URI"
    },
    {
      "code": 6003,
      "name": "invalidConfig",
      "msg": "Invalid config or fee exceeds 5 percent"
    },
    {
      "code": 6004,
      "name": "invalidSupply",
      "msg": "Invalid edition supply"
    },
    {
      "code": 6005,
      "name": "invalidTraits",
      "msg": "Invalid species, growth transition, bond or rules version"
    },
    {
      "code": 6006,
      "name": "invalidClaim",
      "msg": "Invalid claim or event hash"
    },
    {
      "code": 6007,
      "name": "invalidExpiry",
      "msg": "Claim or offer expiration is outside the allowed window"
    },
    {
      "code": 6008,
      "name": "soldOut",
      "msg": "Edition supply is exhausted"
    },
    {
      "code": 6009,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6010,
      "name": "invalidCollection",
      "msg": "Wrong canonical collection or update authority"
    },
    {
      "code": 6011,
      "name": "invalidAsset",
      "msg": "Invalid official asset identity"
    },
    {
      "code": 6012,
      "name": "invalidPlugins",
      "msg": "Unsupported plugin, external adapter, or mutable plugin authority"
    },
    {
      "code": 6013,
      "name": "wrongOwner",
      "msg": "Wallet is not the current Core asset owner"
    },
    {
      "code": 6014,
      "name": "alreadyListed",
      "msg": "Pet is already in escrow"
    },
    {
      "code": 6015,
      "name": "checkpointChanged",
      "msg": "Checkpoint changed; refresh the quote"
    },
    {
      "code": 6016,
      "name": "invalidNonce",
      "msg": "Offer nonce is stale"
    },
    {
      "code": 6017,
      "name": "invalidOffer",
      "msg": "Offer is not the active matching offer"
    },
    {
      "code": 6018,
      "name": "offerExpired",
      "msg": "Offer expired"
    },
    {
      "code": 6019,
      "name": "selfTrade",
      "msg": "Cannot trade with yourself"
    },
    {
      "code": 6020,
      "name": "invalidPrice",
      "msg": "Price must match and be greater than zero"
    }
  ],
  "types": [
    {
      "name": "baseAssetV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": {
              "defined": {
                "name": "key"
              }
            }
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "updateAuthority",
            "type": {
              "defined": {
                "name": "updateAuthority"
              }
            }
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "seq",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "baseCollectionV1",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": {
              "defined": {
                "name": "key"
              }
            }
          },
          {
            "name": "updateAuthority",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "numMinted",
            "type": "u32"
          },
          {
            "name": "currentSize",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "checkpointArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "expectedCheckpoint",
            "type": "u64"
          },
          {
            "name": "form",
            "type": "u8"
          },
          {
            "name": "bond",
            "type": "u32"
          },
          {
            "name": "eventHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "checkpointRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "checkpoint",
            "type": "u64"
          },
          {
            "name": "form",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "claimReceipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "claimId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "edition",
            "type": "pubkey"
          },
          {
            "name": "originHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rulesVersion",
            "type": "u16"
          },
          {
            "name": "expiresAt",
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
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "collection",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "edition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "editionId",
            "type": "u64"
          },
          {
            "name": "maxSupply",
            "type": "u32"
          },
          {
            "name": "issued",
            "type": "u32"
          },
          {
            "name": "originHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rulesVersion",
            "type": "u16"
          },
          {
            "name": "species",
            "type": "u8"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "editionArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "editionId",
            "type": "u64"
          },
          {
            "name": "maxSupply",
            "type": "u32"
          },
          {
            "name": "originHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rulesVersion",
            "type": "u16"
          },
          {
            "name": "species",
            "type": "u8"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "initializeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "uri",
            "type": "string"
          },
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "key",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "uninitialized"
          },
          {
            "name": "assetV1"
          },
          {
            "name": "hashedAssetV1"
          },
          {
            "name": "pluginHeaderV1"
          },
          {
            "name": "pluginRegistryV1"
          },
          {
            "name": "collectionV1"
          },
          {
            "name": "groupV1"
          }
        ]
      }
    },
    {
      "name": "offer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "desiredAsset",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "offeredCheckpoint",
            "type": "u64"
          },
          {
            "name": "desiredCheckpoint",
            "type": "u64"
          },
          {
            "name": "priceLamports",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "offerCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "offer",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "offerOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "offer",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "offerSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "offer",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "petClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "edition",
            "type": "pubkey"
          },
          {
            "name": "serial",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "petRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "edition",
            "type": "pubkey"
          },
          {
            "name": "serial",
            "type": "u32"
          },
          {
            "name": "originHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rulesVersion",
            "type": "u16"
          },
          {
            "name": "species",
            "type": "u8"
          },
          {
            "name": "form",
            "type": "u8"
          },
          {
            "name": "checkpoint",
            "type": "u64"
          },
          {
            "name": "bond",
            "type": "u32"
          },
          {
            "name": "eventHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "checkpointSlot",
            "type": "u64"
          },
          {
            "name": "activeOffer",
            "type": "pubkey"
          },
          {
            "name": "nextOfferNonce",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "updateAuthority",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "none"
          },
          {
            "name": "address",
            "fields": [
              "pubkey"
            ]
          },
          {
            "name": "collection",
            "fields": [
              "pubkey"
            ]
          }
        ]
      }
    }
  ]
};
