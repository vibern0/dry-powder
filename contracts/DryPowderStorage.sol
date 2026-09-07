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
        mapping(address maker => mapping(bytes32 reserveId => uint256[])) thresholds;
        mapping(address maker => mapping(bytes32 reserveId => uint256[])) multipliersBps;
        mapping(address maker => mapping(bytes32 reserveId => mapping(address token => Leg))) legs;
        mapping(address maker => mapping(bytes32 reserveId => uint256)) legCounts;
    }

    bytes32 private constant STORAGE_SLOT = keccak256(
        abi.encode(uint256(keccak256("dry-powder.storage.v1")) - 1)
    ) & ~bytes32(uint256(0xff));

    error InvalidReserveId();
    error InvalidReserveToken();
    error InvalidTotalBudget();
    error InvalidTranches();
    error ReserveAlreadyExists();
    error ReserveNotFound();
    error ReserveAlreadyActive();
    error InvalidLegToken();
    error InvalidLegMaxSpend();
    error LegAlreadyExists();
    error ReserveNeedsLeg();

    event ReserveCreated(address indexed maker, bytes32 indexed reserveId, address indexed reserveToken, uint256 totalBudget);
    event LegAdded(address indexed maker, bytes32 indexed reserveId, address indexed token, uint256 maxSpend);
    event ReserveActivated(address indexed maker, bytes32 indexed reserveId);

    function createReserve(
        bytes32 reserveId,
        address reserveToken,
        uint256 totalBudget,
        uint256[] calldata thresholds,
        uint256[] calldata multipliersBps
    ) external {
        if (reserveId == bytes32(0)) revert InvalidReserveId();
        if (reserveToken == address(0)) revert InvalidReserveToken();
        if (totalBudget == 0) revert InvalidTotalBudget();
        _validateTranches(totalBudget, thresholds, multipliersBps);

        Layout storage $ = _layout();
        Reserve storage reserve = $.reserves[msg.sender][reserveId];
        if (reserve.exists) revert ReserveAlreadyExists();

        reserve.reserveToken = reserveToken;
        reserve.totalBudget = totalBudget;
        reserve.exists = true;

        for (uint256 i; i < thresholds.length; i++) {
            $.thresholds[msg.sender][reserveId].push(thresholds[i]);
            $.multipliersBps[msg.sender][reserveId].push(multipliersBps[i]);
        }

        emit ReserveCreated(msg.sender, reserveId, reserveToken, totalBudget);
    }

    function addLeg(bytes32 reserveId, address token, uint256 maxSpend) external {
        if (token == address(0)) revert InvalidLegToken();
        if (maxSpend == 0) revert InvalidLegMaxSpend();

        Layout storage $ = _layout();
        Reserve storage reserve = $.reserves[msg.sender][reserveId];
        _requireReserve(reserve);
        if (reserve.active) revert ReserveAlreadyActive();

        Leg storage leg = $.legs[msg.sender][reserveId][token];
        if (leg.exists) revert LegAlreadyExists();

        leg.maxSpend = maxSpend;
        leg.exists = true;
        $.legCounts[msg.sender][reserveId]++;

        emit LegAdded(msg.sender, reserveId, token, maxSpend);
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

    function getReserveThresholds(address maker, bytes32 reserveId) external view returns (uint256[] memory) {
        return _layout().thresholds[maker][reserveId];
    }

    function getReserveMultipliersBps(address maker, bytes32 reserveId) external view returns (uint256[] memory) {
        return _layout().multipliersBps[maker][reserveId];
    }

    function getLeg(address maker, bytes32 reserveId, address token) external view returns (Leg memory) {
        return _layout().legs[maker][reserveId][token];
    }

    function _layout() private pure returns (Layout storage $) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            $.slot := slot
        }
    }

    function _requireReserve(Reserve storage reserve) private view {
        if (!reserve.exists) revert ReserveNotFound();
    }

    function _validateTranches(
        uint256 totalBudget,
        uint256[] calldata thresholds,
        uint256[] calldata multipliersBps
    ) private pure {
        if (thresholds.length == 0 || thresholds.length != multipliersBps.length) revert InvalidTranches();

        uint256 previous;
        for (uint256 i; i < thresholds.length; i++) {
            if (thresholds[i] == 0 || thresholds[i] <= previous || thresholds[i] > totalBudget) revert InvalidTranches();
            if (multipliersBps[i] == 0) revert InvalidTranches();
            previous = thresholds[i];
        }

        if (previous != totalBudget) revert InvalidTranches();
    }
}
