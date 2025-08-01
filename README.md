# **Omura – Multi-Asset Decentralized Exchange Network**

A blockchain-based platform for secure, transparent, and automated trading of tokenized assets without intermediaries. Omura enables users to trade any digital asset while maintaining full custody of their funds.  

---

## **Overview**

Omura is built on the principles of **self-custody, transparency, and composability**.  
The platform uses **seven core smart contracts** that together handle asset swaps, liquidity management, order execution, and on-chain governance.

---

## **Features**

- Non-custodial trading with instant settlement  
- Liquidity pools and automated market making (AMM)  
- Limit and market orders with on-chain matching  
- Cross-asset swaps (including stablecoins and wrapped assets)  
- Governance via OMURA tokens for protocol upgrades  
- Fee distribution to liquidity providers  
- On-chain dispute and rollback mechanisms for failed trades  

---

## **Smart Contracts**

### **1. Asset Registry Contract**  
- Maintains a whitelist of supported tokens  
- Tracks wrapped assets and cross-chain bridges  
- Ensures token standard compliance for trading  

### **2. Liquidity Pool Contract**  
- Enables users to provide and withdraw liquidity  
- Calculates pool shares and rewards  
- Handles AMM curve mechanics (e.g., constant product)  

### **3. Swap Execution Contract**  
- Facilitates token-to-token swaps  
- Calculates and applies protocol fees  
- Supports multi-hop trades between pools  

### **4. Order Book Contract**  
- Allows limit and market order placement  
- Handles order matching and partial fills  
- Stores historical trade data  

### **5. Fee Treasury Contract**  
- Collects trading and liquidity fees  
- Distributes rewards to liquidity providers  
- Funds protocol development and buybacks  

### **6. Governance Contract**  
- OMURA token-based voting system  
- Controls protocol upgrades and parameter changes  
- Manages treasury allocations  

### **7. Dispute & Rollback Contract**  
- Resolves failed swaps or liquidity disputes  
- Issues refunds when certain conditions are met  
- Logs disputes on-chain for transparency  

---

## **Installation**

1. Install **Clarinet CLI**  
2. Clone this repository  
3. Install dependencies:  
   ```bash
   npm install
   ```
4. Run tests:
    ```bash
    npm test
    ```
5. Deploy contracts:
    ```bash
    clarinet deploy
    ```

## **Usage**

- Deploy each contract independently via Clarinet
- Add supported assets to the Asset Registry
- Provide liquidity using the Liquidity Pool Contract
- Trade using the Swap Execution and Order Book contracts
- Participate in governance with the OMURA token

## **Testing**

Tests are written using Vitest and can be run with:
```bash
npm test
```

## **License**

MIT License