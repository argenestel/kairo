// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MontionsBook} from "./MontionsBook.sol";
import {Quoter} from "./Quoter.sol";
import {MakerVault} from "./MakerVault.sol";

/// @notice Kairo deployment names; inherited contracts retain the existing ABI.
contract KairoBook is MontionsBook {
    constructor(address collateral_, address owner_) MontionsBook(collateral_, owner_) {}
}
contract KairoQuoter is Quoter {
    constructor(address book_, address resolver_) Quoter(book_, resolver_) {}
}
contract KairoMakerVault is MakerVault {
    constructor(address book_, address quoter_, address owner_) MakerVault(book_, quoter_, owner_) {}
    function name() public pure override returns (string memory) { return "Kairo Maker Vault"; }
    function symbol() public pure override returns (string memory) { return "kmUSDC"; }
    function _constantNameHash() internal pure override returns (bytes32) { return keccak256("Kairo Maker Vault"); }
}
