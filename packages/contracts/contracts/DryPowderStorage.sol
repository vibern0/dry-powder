// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract DryPowderStorage {
    struct Reserve {
        address reserveToken;
        uint256 totalBudget;
        uint256 spent;
        bool active;
        bool exists;
    }

    struct Leg {
        uint256 maxSpend;
        uint256 spent;
        bool exists;
    }

    struct Layout {
        mapping(address maker => mapping(bytes32 reserveId => Reserve)) reserves;
        mapping(address maker => mapping(bytes32 reserveId => mapping(address token => Leg))) legs;
        mapping(address maker => mapping(bytes32 reserveId => mapping(address token => uint256[]))) legSpendCaps;
        mapping(address maker => mapping(bytes32 reserveId => mapping(address token => uint256[]))) legPriceBps;
        mapping(address maker => mapping(bytes32 reserveId => uint256)) legCounts;
    }

    bytes32 internal constant STORAGE_SLOT = keccak256(
        abi.encode(uint256(keccak256("dry-powder.storage.v1")) - 1)
    ) & ~bytes32(uint256(0xff));

    error InvalidReserveId();
    error InvalidReserveToken();
    error InvalidTotalBudget();
    error InvalidLegLadder();
    error ReserveAlreadyExists();
    error ReserveNotFound();
    error ReserveAlreadyActive();
    error InvalidLegToken();
    error InvalidLegMaxSpend();
    error LegAlreadyExists();
    error LegNotFound();
    error LegMaxSpendBelowSpent();
    error ReserveNeedsLeg();

    event ReserveCreated(address indexed maker, bytes32 indexed reserveId, address indexed reserveToken, uint256 totalBudget);
    event LegAdded(address indexed maker, bytes32 indexed reserveId, address indexed token, uint256 maxSpend);
    event LegUpdated(address indexed maker, bytes32 indexed reserveId, address indexed token, uint256 maxSpend);
    event LegRemoved(address indexed maker, bytes32 indexed reserveId, address indexed token, uint256 spent);
    event ReserveActivated(address indexed maker, bytes32 indexed reserveId);

    function createReserve(
        bytes32 reserveId,
        address reserveToken,
        uint256 totalBudget
    ) external {
        if (reserveId == bytes32(0)) revert InvalidReserveId();
        if (reserveToken == address(0)) revert InvalidReserveToken();
        if (totalBudget == 0) revert InvalidTotalBudget();

        Layout storage $ = _layout();
        Reserve storage reserve = $.reserves[msg.sender][reserveId];
        if (reserve.exists) revert ReserveAlreadyExists();

        reserve.reserveToken = reserveToken;
        reserve.totalBudget = totalBudget;
        reserve.exists = true;

        emit ReserveCreated(msg.sender, reserveId, reserveToken, totalBudget);
    }

    function addLeg(bytes32 reserveId, address token, uint256[] calldata spendCaps, uint256[] calldata priceBps) external {
        if (token == address(0)) revert InvalidLegToken();
        uint256 maxSpend = _validateLegLadder(spendCaps, priceBps);

        Layout storage $ = _layout();
        Reserve storage reserve = $.reserves[msg.sender][reserveId];
        _requireReserve(reserve);

        Leg storage leg = $.legs[msg.sender][reserveId][token];
        if (leg.exists) revert LegAlreadyExists();
        if (maxSpend < leg.spent) revert LegMaxSpendBelowSpent();

        leg.maxSpend = maxSpend;
        leg.exists = true;
        $.legCounts[msg.sender][reserveId]++;
        _setLegLadder($, msg.sender, reserveId, token, spendCaps, priceBps);

        emit LegAdded(msg.sender, reserveId, token, maxSpend);
    }

    function updateLeg(bytes32 reserveId, address token, uint256[] calldata spendCaps, uint256[] calldata priceBps) external {
        uint256 maxSpend = _validateLegLadder(spendCaps, priceBps);

        Layout storage $ = _layout();
        Reserve storage reserve = $.reserves[msg.sender][reserveId];
        _requireReserve(reserve);

        Leg storage leg = $.legs[msg.sender][reserveId][token];
        if (!leg.exists) revert LegNotFound();
        if (maxSpend < leg.spent) revert LegMaxSpendBelowSpent();

        leg.maxSpend = maxSpend;
        _setLegLadder($, msg.sender, reserveId, token, spendCaps, priceBps);

        emit LegUpdated(msg.sender, reserveId, token, maxSpend);
    }

    function removeLeg(bytes32 reserveId, address token) external {
        Layout storage $ = _layout();
        Reserve storage reserve = $.reserves[msg.sender][reserveId];
        _requireReserve(reserve);

        Leg storage leg = $.legs[msg.sender][reserveId][token];
        if (!leg.exists) revert LegNotFound();

        uint256 spent = leg.spent;
        leg.maxSpend = 0;
        leg.exists = false;
        delete $.legSpendCaps[msg.sender][reserveId][token];
        delete $.legPriceBps[msg.sender][reserveId][token];
        $.legCounts[msg.sender][reserveId]--;

        emit LegRemoved(msg.sender, reserveId, token, spent);
    }

    function activateReserve(bytes32 reserveId) external {
        Layout storage $ = _layout();
        Reserve storage reserve = $.reserves[msg.sender][reserveId];
        _requireReserve(reserve);
        if (reserve.active) revert ReserveAlreadyActive();
        if ($.legCounts[msg.sender][reserveId] == 0) revert ReserveNeedsLeg();

        reserve.active = true;

        emit ReserveActivated(msg.sender, reserveId);
    }

    function getReserve(address maker, bytes32 reserveId) external view returns (Reserve memory) {
        return _layout().reserves[maker][reserveId];
    }

    function getLegSpendCaps(address maker, bytes32 reserveId, address token) external view returns (uint256[] memory) {
        return _layout().legSpendCaps[maker][reserveId][token];
    }

    function getLegPriceBps(address maker, bytes32 reserveId, address token) external view returns (uint256[] memory) {
        return _layout().legPriceBps[maker][reserveId][token];
    }

    function getLeg(address maker, bytes32 reserveId, address token) external view returns (Leg memory) {
        return _layout().legs[maker][reserveId][token];
    }

    function _layout() internal pure returns (Layout storage $) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            $.slot := slot
        }
    }

    function _requireReserve(Reserve storage reserve) internal view {
        if (!reserve.exists) revert ReserveNotFound();
    }

    function _validateLegLadder(
        uint256[] calldata spendCaps,
        uint256[] calldata priceBps
    ) private pure returns (uint256 maxSpend) {
        if (spendCaps.length == 0 || spendCaps.length != priceBps.length) revert InvalidLegLadder();
        if (priceBps[0] != 10_000) revert InvalidLegLadder();

        uint256 previous;
        uint256 previousPrice = 10_000;
        for (uint256 i; i < spendCaps.length; i++) {
            if (spendCaps[i] == 0 || spendCaps[i] <= previous) revert InvalidLegLadder();
            if (priceBps[i] == 0 || priceBps[i] > previousPrice) revert InvalidLegLadder();
            previous = spendCaps[i];
            previousPrice = priceBps[i];
        }

        return previous;
    }

    function _setLegLadder(
        Layout storage $,
        address maker,
        bytes32 reserveId,
        address token,
        uint256[] calldata spendCaps,
        uint256[] calldata priceBps
    ) private {
        delete $.legSpendCaps[maker][reserveId][token];
        delete $.legPriceBps[maker][reserveId][token];
        for (uint256 i; i < spendCaps.length; i++) {
            $.legSpendCaps[maker][reserveId][token].push(spendCaps[i]);
            $.legPriceBps[maker][reserveId][token].push(priceBps[i]);
        }
    }
}
