// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
pragma abicoder v2;

interface IFederation {

  /**
    @notice Current version of the contract
    @return version in v{Number}
    */
  function version() external pure returns (string memory);

  /**
    @notice Sets a new bridge contract
    @param _bridge the new bridge contract address that should implement the IBridge interface
  */
  function setBridge(address _bridge) external;

  /**
    @notice Vote in a transaction, if it has enough votes it accepts the transfer
    @param originalTokenAddress The address of the token in the origin (main) chain
    @param sender The address who solicited the cross token
    @param receiver Who is going to receive the token in the opposite chain
    @param value Amount
    @param blockHash The block hash in which the transaction with the cross event occurred
    @param transactionHash The transaction in which the cross event occurred
    @param logIndex Index of the event in the logs
		@param originChainId Is chainId of the original chain
		@param destinationChainId Is chainId of the destination chain
  */
  function voteTransaction(
    address originalTokenAddress,
    address payable sender,
    address payable receiver,
    uint256 value,
    bytes32 blockHash,
    bytes32 transactionHash,
    uint32 logIndex,
	  uint256 originChainId,
	  uint256	destinationChainId
  ) external;

  /**
    @notice Add a new member to the federation
    @param _newMember address of the new member
  */
  function addMember(address _newMember) external;

  /**
    @notice Remove a member of the federation
    @param _oldMember address of the member to be removed from federation
  */
  function removeMember(address _oldMember) external;

  /**
    @notice Return all the current members of the federation
    @return Current members
  */
  function getMembers() external view returns (address[] memory);

  /**
    @notice Changes the number of required members to vote and approve an transaction
    @param _required the number of minimum members to approve an transaction, it has to be bigger than 1
  */
  function changeRequirement(uint _required) external;

  /**
    @notice It emmits an HeartBeat like an healthy check
  */
  function emitHeartbeat(
    string calldata federatorVersion,
		uint256[] calldata fedChainsIds,
		uint256[] calldata fedChainsBlocks,
		string[] calldata fedChainsInfo
  ) external;

  event Executed(
    address indexed federator,
    bytes32 indexed transactionHash,
    bytes32 indexed transactionId,
    address originalTokenAddress,
    address sender,
    address receiver,
    uint256 amount,
    bytes32 blockHash,
    uint32 logIndex,
		uint256 originChainId,
		uint256	destinationChainId
  );
  event MemberAddition(address indexed member);
  event MemberRemoval(address indexed member);
  event RequirementChange(uint required);
  event BridgeChanged(address bridge);
  event Voted(
    address indexed federator,
    bytes32 indexed transactionHash,
    bytes32 indexed transactionId,
    address originalTokenAddress,
    address sender,
    address receiver,
    uint256 amount,
    bytes32 blockHash,
    uint32 logIndex,
    uint256 originChainId,
		uint256	destinationChainId
  );
  event HeartBeat(
    address indexed sender,
    uint256 currentChainId,
    uint256 currentBlock,
    string fedVersion,
    uint256[] fedChainsIds,
		uint256[] fedChainsBlocks,
		string[] fedChainsInfo
  );

}
