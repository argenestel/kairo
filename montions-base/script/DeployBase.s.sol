// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DeployEvm} from "./DeployEvm.s.sol";

/// @notice Back-compat alias for Base Sepolia. Prefer `script/DeployEvm.s.sol:DeployEvm`.
contract DeployBase is DeployEvm {}
