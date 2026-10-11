// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VaultTestBase} from "./VaultTestBase.sol";
contract VaultScaleTest is VaultTestBase {
    bytes32 internal last;
    function setUp() public override {
        super.setUp();
        _depositVault(ALICE, 1_000_000e6);
        vault.setCaps(15,3000,2000);
        for(uint256 i; i<149; ++i) {
            bytes32 id=_createSeries(abi.encode(i),expiry);
            quoter.setFair(id,50);
            vm.prank(KEEPER);
            vault.refresh(id);
        }
        last=_createSeries(bytes("last"),expiry);
        quoter.setFair(last,50);
    }
    function testColdRefreshAt150SeriesFitsBaseTransactionCap() public {
        uint256 beforeGas=gasleft();
        vm.prank(KEEPER);
        vault.refresh(last);
        uint256 used=beforeGas-gasleft();
        emit log_named_uint("cold refresh gas at 150 markets",used);
        assertLt(used, 16_777_216);
        assertEq(vault.activeSeries().length,150);
        assertGt(vault.trackedOrders(last).length,0);
        assertEq(vault.totalAssets(),1_000_000e6);
    }
}
