# Testnet Automation

Hermes AI agent scripts for automated testnet operations on Sepolia.

## Features

### Overlayer Daily Tasks
- Auto-stake C+ / T+ tokens
- Bridge T+ via LayerZero OFT
- Send/receive between wallets
- Multiple extra transactions to boost tx count

### Supported Wallets
- evm-01, evm-02, evm-03 (Sepolia EVM)

## Getting Started

```bash
git clone https://github.com/Ndollo2038/testnet-automation
cd testnet-automation
npm install ethers
```

## Directory Structure

```
├── overlayer-task/     # Overlayer daily scripts
│   ├── run_daily_now.js     # Full daily cycle (no API auth)
│   ├── run_daily_light.js   # Light version for low-ETH wallets
│   └── check_today.js       # Check task status
└── README.md
```
