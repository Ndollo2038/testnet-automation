const { ethers } = require('ethers');
const fs = require('fs');
function parseEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(m)o[m[1]]=m[2].replace(/^['\"]|['\"]$/g,'')}return o}
function short(a){return a.slice(0,6)+'...'+a.slice(-4)}
function link(h){return `https://sepolia.etherscan.io/tx/${h}`}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const RPC='https://ethereum-sepolia-rpc.publicnode.com';
const STPLUS='0x079a4Bf1Cbd0E4ce15391340cB46efA6396aBc82'; // sT+ vault
const SCPLUS='0x753937137Eb92871A6F3517514d4f1Ee860e3FDF'; // sC+ vault
const CPLUS='0xE815718D44694ec4637CB775C468d87f6e15B538'; // C+
const TPLUS='0xe20534a32f9162488a90026F268a74fBE28d272D'; // T+
const erc20Abi=['function balanceOf(address)view returns(uint256)','function allowance(address,address)view returns(uint256)','function approve(address,uint256) returns(bool)'];
const vaultAbi=['function deposit(uint256,address) returns(uint256)'];

async function send(label, txp){
  const tx=await txp;
  console.log(`✅ ${label} -> ${link(tx.hash)}`);
  const r=await tx.wait(1);
  console.log(`   status=${r.status} block=${r.blockNumber} gasUsed=${r.gasUsed.toString()}`);
  if(r.status!==1) throw new Error(label+' failed');
  return tx.hash;
}

(async()=>{
  const targetWallet=process.argv[2] || 'evm-03';
  const p=new ethers.JsonRpcProvider(RPC,11155111,{staticNetwork:true});
  const e=parseEnv(`/root/.naya/accounts/credentials/${targetWallet}.env`);
  const w=new ethers.Wallet(e.EVM_PRIVATE_KEY,p);
  if(w.address.toLowerCase()!==e.EVM_ADDRESS.toLowerCase()) throw new Error('key/address mismatch');
  
  console.log(`\n=== Overlayer Daily: ${targetWallet} ${short(w.address)} ===`);
  
  const ethBal=await p.getBalance(w.address);
  console.log(`ETH: ${ethers.formatEther(ethBal)}`);
  
  // Show current balances
  const cContract=new ethers.Contract(CPLUS,erc20Abi,p);
  const scVault=new ethers.Contract(SCPLUS,vaultAbi,w);
  const tContract=new ethers.Contract(TPLUS,erc20Abi,p);
  const stVault=new ethers.Contract(STPLUS,vaultAbi,w);
  
  const cBal=await cContract.balanceOf(w.address);
  const scBal=await new ethers.Contract(SCPLUS,['function balanceOf(address)view returns(uint256)'],p).balanceOf(w.address);
  const tBal=await tContract.balanceOf(w.address);
  const stBal=await new ethers.Contract(STPLUS,['function balanceOf(address)view returns(uint256)'],p).balanceOf(w.address);
  
  console.log(`C+: ${ethers.formatEther(cBal)} | sC+: ${ethers.formatEther(scBal)}`);
  console.log(`T+: ${ethers.formatEther(tBal)} | sT+: ${ethers.formatEther(stBal)}`);
  
  const hashes=[];
  
  // 1. Stake 265 C+ → sC+
  if(cBal >= ethers.parseEther('265')){
    console.log('\n--- Step 1: Stake 265 C+ ---');
    const curAllow=await cContract.allowance(w.address,SCPLUS);
    if(curAllow < ethers.parseEther('265')){
      const approveTx = await cContract.connect(w).approve(SCPLUS, ethers.parseEther('500'));
      await approveTx.wait(1);
      console.log(`✅ approve C+ -> ${link(approveTx.hash)}`);
      hashes.push(approveTx.hash);
    }
    hashes.push(await send(`stake_265_Cplus`, scVault.deposit(ethers.parseEther('265'), w.address)));
    await sleep(3000);
  } else {
    console.log('\n⚠️ C+ balance too low for stake 265');
  }
  
  // 2. Bridge 485 T+ via OFT
  if(tBal >= ethers.parseEther('485')){
    console.log('\n--- Step 2: Bridge 485 T+ ---');
    const oftAbi=[...['function balanceOf(address)view returns(uint256)','function allowance(address,address)view returns(uint256)','function approve(address,uint256) returns(bool)','function transfer(address,uint256) returns(bool)'],
      'function quoteSend((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),bool payInLzToken) view returns((uint256 nativeFee,uint256 lzTokenFee))',
      'function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress) payable returns((bytes32 guid,uint64 nonce,(uint256 nativeFee,uint256 lzTokenFee) fee),(uint256 amountSentLD,uint256 amountReceivedLD))'];
    const tOft=new ethers.Contract(TPLUS,oftAbi,w);
    const params={dstEid:40245,to:ethers.zeroPadValue(w.address,32),amountLD:ethers.parseEther('485'),minAmountLD:ethers.parseEther('485'),extraOptions:'0x0003',composeMsg:'0x',oftCmd:'0x'};
    try {
      const q=await tOft.quoteSend(params,false);
      console.log(`Bridge nativeFee: ${ethers.formatEther(q.nativeFee)} ETH`);
      const feeObj={nativeFee:q.nativeFee,lzTokenFee:q.lzTokenFee};
      
      // Check if we have enough ETH
      const postBal=await p.getBalance(w.address);
      if(postBal < q.nativeFee + ethers.parseEther('0.005')){
        console.log('⚠️ Not enough ETH for bridge fee');
      } else {
        const gas=await p.estimateGas({from:w.address,to:TPLUS,data:tOft.interface.encodeFunctionData('send',[params,feeObj,w.address]),value:feeObj.nativeFee});
        const tx=await w.sendTransaction({to:TPLUS,data:tOft.interface.encodeFunctionData('send',[params,feeObj,w.address]),value:feeObj.nativeFee,gasLimit:gas*12n/10n});
        console.log(`✅ bridge_485_Tplus -> ${link(tx.hash)}`);
        const rc=await tx.wait(1);
        console.log(`   status=${rc.status} block=${rc.blockNumber} gasUsed=${rc.gasUsed.toString()}`);
        hashes.push(tx.hash);
        await sleep(3000);
      }
    } catch(e){
      console.log(`⚠️ Bridge failed: ${e.message.slice(0,150)}`);
    }
  } else {
    console.log('\n⚠️ T+ balance too low for bridge 485');
  }
  
  // 3. Extra tx — stake 10 T+ each to boost count
  console.log('\n--- Step 3: Extra transactions ---');
  const extraAmt=ethers.parseEther('10');
  const curTAllow=await tContract.allowance(w.address,STPLUS);
  if(curTAllow < ethers.parseEther('500')){
    const approveTx = await tContract.connect(w).approve(STPLUS, ethers.parseEther('500'));
    await approveTx.wait(1);
    console.log(`✅ approve T+ extra -> ${link(approveTx.hash)}`);
    hashes.push(approveTx.hash);
  }
  
  let extraCount=0;
  const MAX_EXTRA=15; // 15 extra tx per wallet
  for(let i=0; i<MAX_EXTRA; i++){
    const curEth=await p.getBalance(w.address);
    if(curEth < ethers.parseEther('0.002')){
      console.log(`⚠️ OUT OF ETH at extra #${i+1}`);
      break;
    }
    try {
      hashes.push(await send(`extra_stake_${i+1}_10_Tplus`, stVault.deposit(extraAmt, w.address)));
      extraCount++;
      await sleep(2000);
    } catch(e){
      if(e.message.includes('insufficient funds')){
        console.log(`⚠️ OUT OF FUNDS at extra #${i+1}`);
        break;
      } else if(e.message.includes('reverted')){
        console.log(`⚠️ TX reverted at extra #${i+1}, sleeping longer...`);
        await sleep(10000);
        // Try once more
        try {
          hashes.push(await send(`extra_stake_${i+1}_10_Tplus_retry`, stVault.deposit(extraAmt, w.address)));
          extraCount++;
        } catch(e2) {
          console.log(`⚠️ Retry failed: ${e2.message.slice(0,100)}`);
          break;
        }
      } else {
        console.log(`⚠️ Error at extra #${i+1}: ${e.message.slice(0,100)}`);
        break;
      }
    }
  }
  
  // Final report
  const finalEth=await p.getBalance(w.address);
  const finalW=new ethers.Contract(SCPLUS,['function balanceOf(address)view returns(uint256)'],p);
  const finalSc=await finalW.balanceOf(w.address);
  
  console.log(`\n=== FINAL ${targetWallet} ===`);
  console.log(`Txs sent: ${hashes.length}`);
  console.log(`Extra stakes: ${extraCount}`);
  console.log(`ETH: ${ethers.formatEther(ethBal)} → ${ethers.formatEther(finalEth)} (used ${ethers.formatEther(ethBal-finalEth)})`);
  console.log(`sC+: ${ethers.formatEther(scBal)} → ${ethers.formatEther(finalSc)}`);
  console.log(`Hashes:`);
  hashes.forEach(h => console.log(`  ${link(h)}`));
  
  console.log('\n✅ DONE');
})().catch(e=>{console.error('FATAL:',e.message);process.exit(1);});
