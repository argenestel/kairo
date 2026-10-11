// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ChainlinkSettlementResolver} from "../src/resolvers/ChainlinkSettlementResolver.sol";
import {ChainlinkOracle} from "../src/oracle/chainlink/ChainlinkOracle.sol";
import {MontionsBook} from "../src/MontionsBook.sol";
import {MakerVault} from "../src/MakerVault.sol";
import {Quoter} from "../src/Quoter.sol";

/// @notice Deploy a replacement ChainlinkSettlementResolver and point Book/Vault/Quoter at it.
/// @dev Live-only helper for ship2 after a quoting-band fix. Reads addresses from env.
contract DeployResolver is Script {
    function run() external {
        address oracle = vm.envAddress("ORACLE");
        address book = vm.envAddress("BOOK");
        address vault = vm.envAddress("VAULT");
        address quoter = vm.envAddress("QUOTER");
        vm.startBroadcast();
        ChainlinkSettlementResolver resolver = new ChainlinkSettlementResolver(oracle);
        MontionsBook(book).setResolverAllowed(address(resolver), true);
        MakerVault(vault).setTrustedResolver(address(resolver));
        Quoter(quoter).setPriceResolver(address(resolver), true);
        vm.stopBroadcast();
        console2.log("ChainlinkSettlementResolver", address(resolver));
        console2.log("oracle", oracle);
    }
}
