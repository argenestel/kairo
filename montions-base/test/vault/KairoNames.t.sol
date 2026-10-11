// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {KairoBook, KairoQuoter, KairoMakerVault} from "../../src/Kairo.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
contract KairoNamesTest is Test {
    function testDeploymentMetadataAndPermitDomain() public {
        TestUSDC token = new TestUSDC(address(this));
        KairoBook book = new KairoBook(address(token), address(this));
        KairoQuoter quoter = new KairoQuoter(address(book), address(0x123));
        KairoMakerVault vault = new KairoMakerVault(address(book), address(quoter), address(this));
        assertEq(vault.name(), "Kairo Maker Vault");
        assertEq(vault.symbol(), "kmUSDC");
        bytes32 expected = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("Kairo Maker Vault"), keccak256("1"), block.chainid, address(vault)));
        assertEq(vault.DOMAIN_SEPARATOR(), expected);
    }
}
