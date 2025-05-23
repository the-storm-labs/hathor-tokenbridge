// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;
pragma abicoder v2;
interface IBridge {

	struct ClaimData {
		address payable to;
		uint256 amount;
		bytes32 blockHash;
		bytes32 transactionHash;
		uint32 logIndex;
		uint256 originChainId;
	}

	struct OriginalToken {
		address tokenAddress;
		uint256 originChainId;
	}
	
	struct CreateSideTokenStruct {
		uint256 _typeId;
		address _originalTokenAddress;
		uint8 _originalTokenDecimals;
		string _originalTokenSymbol;
		string _originalTokenName;
		uint256 _originChainId;
	}

	function version() external pure returns (string memory);

	function getFeePercentage() external view returns(uint);

	/**
		* ERC-20 tokens approve and transferFrom pattern
		* See https://eips.ethereum.org/EIPS/eip-20#transferfrom
		*/
	function receiveTokensTo(uint256 chainId, address tokenToUse, string memory hathorTo, uint256 amount) external;

	/**
		* Use network currency and cross it.
		*/
	function depositTo(uint256 chainId, string memory hathorTo) external payable;

	/**
		* ERC-777 tokensReceived hook allows to send tokens to a contract and notify it in a single transaction
		* See https://eips.ethereum.org/EIPS/eip-777#motivation for details
		* @param userData it can be 2 options in the first one you can send the receiver and the chain id of the destination
		* const userData = web3.eth.abi.encodeParameters(
    *   ["address", "uint256"],
    *   [anAccount.toLowerCase(), chains.ETHEREUM_MAIN_NET_CHAIN_ID]
    * );
		* or you also can send only the destination chain id, and the receiver would be the same as the from parameter
		* const userData = web3.eth.abi.encodeParameters(["uint256"], [chains.ETHEREUM_MAIN_NET_CHAIN_ID]);
		*/
	function tokensReceived (
		address operator,
		address from,
		address to,
		uint amount,
		bytes calldata userData,
		bytes calldata operatorData
	) external;

	/**
		* Accepts the transaction from the other chain that was voted and sent by the Federation contract
		*/
	function acceptTransfer(
		address _originalTokenAddress,
		address payable _from,
		address payable _to,
		uint256 _amount,
		bytes32 _blockHash,
		bytes32 _transactionHash,
		uint32 _logIndex,
		uint256 _originChainId,
		uint256	_destinationChainId
	) external;

	/**
		* Claims the crossed transaction using the hash, this sends the funds to the address indicated in
		*/
	function claim(ClaimData calldata _claimData) external returns (uint256 receivedAmount);

	function claimFallback(ClaimData calldata _claimData) external returns (uint256 receivedAmount);

	function claimGasless(
		ClaimData calldata _claimData,
		address payable _relayer,
		uint256 _fee,
		uint256 _deadline,
		uint8 _v,
		bytes32 _r,
		bytes32 _s
	) external returns (uint256 receivedAmount);

	function createSideToken(
		uint256 _typeId,
		address _originalTokenAddress,
		uint8 _originalTokenDecimals,
		string calldata _originalTokenSymbol,
		string calldata _originalTokenName,
		uint256 _chainId
	) external;

	function createMultipleSideTokens(
		CreateSideTokenStruct[] calldata createSideTokenStruct
	) external;

	function getTransactionDataHash(
		address _to,
		uint256 _amount,
		bytes32 _blockHash,
		bytes32 _transactionHash,
		uint32 _logIndex,
		uint256 _originChainId,
		uint256 _destinationChainId
	) external returns(bytes32);

	event Cross(
		address indexed _tokenAddress,
		string _to,
		uint256 indexed _destinationChainId,
		address _from,
		uint256 _originChainId,
		uint256 _amount,
		bytes _userData
	);

	event NewSideToken(
		address indexed _newSideTokenAddress,
		address indexed _originalTokenAddress,
		string _newSymbol,
		uint256 _granularity,
		uint256 _chainId
	);
	event AcceptedCrossTransfer(
		bytes32 indexed _transactionHash,
		address indexed _originalTokenAddress,
		address indexed _to,
		address  _from,
		uint256 _amount,
		bytes32 _blockHash,
		uint256 _logIndex,
		uint256 _originChainId,
		uint256	_destinationChainId
	);
	event FeePercentageChanged(uint256 _amount);
	event Claimed(
		bytes32 indexed _transactionHash,
		address indexed _originalTokenAddress,
		address indexed _to,
		address _sender,
		uint256 _amount,
		bytes32 _blockHash,
		uint256 _logIndex,
		address _reciever,
		address _relayer,
		uint256 _fee,
		uint256 _destinationChainId,
		uint256 _originChainId
	);
}