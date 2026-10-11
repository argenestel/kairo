// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Script, console2} from "forge-std/Script.sol";
import {MakerVault} from "../src/MakerVault.sol";
import {KairoMakerVault} from "../src/Kairo.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
/// @notice Replace only the vault to accommodate the full stock catalog. Preserve original shares/assets.
contract RotateVault is Script {
    function run() external {
        uint256 cid=block.chainid;
        bool fork=vm.envOr("FORK_REHEARSAL",uint256(0))==1;
        require(fork || ((cid==84532 || cid==421614) && vm.envOr("ALLOW_LIVE_VAULT_ROTATION",uint256(0))==1),"explicit live rotation required");
        string memory manifest=vm.readFile(vm.envString("DEPLOYMENT"));
        address book=vm.parseJsonAddress(manifest,".contracts.book");
        address quoter=vm.parseJsonAddress(manifest,".contracts.quoter");
        address resolver=vm.parseJsonAddress(manifest,".contracts.chainlinkResolver");
        address collateral=vm.parseJsonAddress(manifest,".contracts.collateral");
        MakerVault old=MakerVault(vm.parseJsonAddress(manifest,".contracts.vault"));
        require(old.owner()==msg.sender,"owner required");
        require(msg.sender.balance > vm.envOr("LIVE_MIN_RESERVE_WEI",uint256(0)),"reserve");
        bytes32[] memory active=old.activeSeries();
        vm.startBroadcast();
        old.setQuotingPaused(true);
        for(uint256 i;i<active.length;++i) old.refresh(active[i]);
        KairoMakerVault vault=new KairoMakerVault(book,quoter,msg.sender);
        vault.setKeeper(msg.sender);
        vault.setTrustedResolver(resolver);
        vault.setTrustedAsset(keccak256("ETH"),true,25e18);
        vault.setTrustedAsset(keccak256("BTC"),true,500e18);
        vault.setTrustedAsset(keccak256("LINK"),true,0.25e18);
        vault.setCaps(15,3000,2000);
        vault.setMaxTotalAssets(5_000_000e6);
        string memory stocks=vm.readFile("config/stocks.json");
        for(uint256 i;i<29;++i) {
            string memory p=string.concat(".assets[",vm.toString(i),"]");
            vault.setTrustedAsset(keccak256(bytes(vm.parseJsonString(stocks,string.concat(p,".symbol")))),true,vm.parseJsonUint(stocks,string.concat(p,".strikeStepWad")));
        }
        TestUSDC(collateral).mint(msg.sender,1_000_000e6);
        TestUSDC(collateral).approve(address(vault),1_000_000e6);
        vault.deposit(1_000_000e6,msg.sender);
        vm.stopBroadcast();
        vm.serializeAddress("vault","previousVault",address(old));
        string memory json=vm.serializeAddress("vault","vault",address(vault));
        vm.writeJson(json,vm.envString("OUT"));
        console2.log("new Kairo vault",address(vault));
        console2.log("old quotes cancelled",active.length);
    }
}
