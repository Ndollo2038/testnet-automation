const { ethers } = require('ethers');
const fs = require('fs');
function parseEnv(p){const o={};for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(m)o[m[1]]=m[2].replace(/^['\"]|['\"]$/g,'')}return o}
function link(h){return `https://sepolia.etherscan.io/tx/${h}`}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const RPC='https://ethereum-sepolia-rpc.publicnode.com';
const SCPLUS='0x753937137Eb92871A6F3517514d4f1Ee860e3FDF';
const STPLUS='0x079a4Bf1Cbd0E4ce15391340cB46efA6396aBc82';
const CPLUS='0xE815718D44694ec4637CB775C468d87f6e15B538';
const TPLUS='0xe20534a32f9162488a90026F268a74fBE28d272D';
const erc20Abi=['function balanceOf(address)view returns(uint256)','function allowance(address,address)view returns(uint256)','function approve(address,uint256) returns(bool)'];
const vaultAbi=['function deposit(uint256,address) returns(uint256)'];

(async()=>{
  const targetWallet=process.argv[2] || 'evm-01';
  const maxExtra=parseInt(process.argv[3] || '5'); // fewer extra for low-eth wallets
  const p=new ethers.JsonRpcProvider(RPC,11155111,{staticNetwork:true});
  const e=parseEnv(`/root/.naya/accounts/credentials/${targetWallet}.env`);
  const w=new ethers.Wallet(e.EVM_PRIVATE_KEY,p);
  
  console.log(`\n=== Overlayer Daily: ${targetWallet} ${w.address.slice(0,8)}...${w.address.slice(-4)} ===`);
  const ethBal=await p.getBalance(w.address);
  console.log(`ETH: ${ethers.formatEther(ethBal)} | MaxExtra: ${maxExtra}`);
  
  const scVault=new ethers.Contract(SCPLUS,vaultAbi,w);
  const stVault=new ethers.Contract(STPLUS,vaultAbi,w);
  const cContract=new ethers.Contract(CPLUS,erc20Abi,p);
  const tContract=new ethers.Contract(TPLUS,erc20Abi,p);
  const cBal=await cContract.balanceOf(w.address);
  const tBal=await tContract.balanceOf(w.address);
  console.log(`C+: ${ethers.formatEther(cBal)} | T+: ${ethers.formatEther(tBal)}`);
  
  const hashes=[];
  
  // Step 1: Stake 265 C+
  if(cBal >= ethers.parseEther('265')){
    console.log('\n--- Step 1: Stake 265 C+ ---');
    const curAllow=await cContract.allowance(w.address,SCPLUS);
    if(curAllow < ethers.parseEther('265')){
      const approveTx = await cContract.connect(w).approve(SCPLUS, ethers.parseEther('500'));
      await approveTx.wait(1);
      hashes.push(approveTx.hash);
      await sleep(2000);
    }
    const tx = await scVault.deposit(ethers.parseEther('265'), w.address);
    const r = await tx.wait(1);
    console.log(`✅ stake_265_Cplus -> ${link(tx.hash)}  status=${r.status}`);
    hashes.push(tx.hash);
    await sleep(2000);
  }
  
  // Step 2: Bridge 485 T+
  if(tBal >= ethers.parseEther('485')){
    console.log('\n--- Step 2: Bridge 485 T+ ---');
    const oftAbi=[...['function balanceOf(address)view returns(uint256)','function allowance(address,address)view returns(uint256)','function approve(address,uint256) returns(bool)','function transfer(address,uint256) returns(bool)'],
      'function quoteSend((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),bool payInLzToken) view returns((uint256 nativeFee,uint256 lzTokenFee))',
      'function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress) payable'];
    const tOft=new ethers.Contract(TPLUS,oftAbi,w);
    const params={dstEid:40245,to:ethers.zeroPadValue(w.address,32),amountLD:ethers.parseEther('485'),minAmountLD:ethers.parseEther('485'),extraOptions:'0x0003',composeMsg:'0x',oftCmd:'0x'};
    try {
      const q=await tOft.quoteSend(params,false);
      const feeObj={nativeFee:q.nativeFee,lzTokenFee:q.lzTokenFee};
      const totalCost = q.nativeFee + ethers.parseEther('0.01'); // gas budget
      if(ethBal > totalCost){
        const gas=await p.estimateGas({from:w.address,to:TPLUS,data:tOft.interface.encodeFunctionData('send',[params,feeObj,w.address]),value:feeObj.nativeFee});
        const tx=await w.sendTransaction({to:TPLUS,data:tOft.interface.encodeFunctionData('send',[params,feeObj,w.address]),value:feeObj.nativeFee,gasLimit:gas*12n/10n});
        const rc=await tx.wait(1);
        console.log(`✅ bridge_485_Tplus -> ${link(tx.hash)}  status=${rc.status}`);
        hashes.push(tx.hash);
        await sleep(2000);
      } else { console.log('⚠️ Not enough ETH for bridge'); }
    } catch(e){ console.log(`⚠️ Bridge failed: ${e.message.slice(0,100)}`); }
  }
  
  // Step 3: Extra tx — stake 10 T+
  console.log('\n--- Step 3: Extra transactions ---');
  const extraAmt=ethers.parseEther('10');
  const curTAllow=await tContract.allowance(w.address,STPLUS);
  if(curTAllow < ethers.parseEther('500')){
    const approveTx = await tContract.connect(w).approve(STPLUS, ethers.parseEther('500'));
    await approveTx.wait(1);
    hashes.push(approveTx.hash);
    await sleep(2000);
  }
  
  for(let i=0; i<maxExtra; i++){
    const curEth=await p.getBalance(w.address);
    if(curEth < ethers.parseEther('0.003')){
      console.log(`⚠️ OUT OF ETH at extra #${i+1}`);
      break;
    }
    try {
      const tx=await stVault.deposit(extraAmt, w.address);
      const r=await tx.wait(1);
      console.log(`✅ extra_stake_${i+1} -> ${link(tx.hash)}  status=${r.status}`);
      hashes.push(tx.hash);
      await sleep(2000);
    } catch(e){
      if(e.message.includes('insufficient funds')){ console.log(`⚠️ OUT OF ETH`); break; }
      else { console.log(`⚠️ Error #${i+1}: ${e.message.slice(0,80)}`); break; }
    }
  }
  
  const finalEth=await p.getBalance(w.address);
  console.log(`\n=== FINAL ${targetWallet} ===`);
  console.log(`Tx: ${hashes.length} | ETH: ${ethers.formatEther(ethBal)} → ${ethers.formatEther(finalEth)} (used ${ethers.formatEther(ethBal-finalEth)})`);
  hashes.forEach(h => console.log(`  ${link(h)}`));
})().catch(e=>{console.error('FATAL:',e.message);process.exit(1);});
