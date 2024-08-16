
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma abicoder v2;

// Upgradables
import "../zeppelin/upgradable/Initializable.sol";
import "../zeppelin/upgradable/ownership/UpgradableOwnable.sol";

contract HathorTransactions is Initializable, UpgradableOwnable {

    address constant private NULL_ADDRESS = address(0);
    uint constant public MAX_MEMBER_COUNT = 50;

    address[] public members;

	/**
	@notice All the addresses that are members of the federation
	@dev The address should be a member to vote in transactions
	*/

	mapping (address => bool) public isMember;

    mapping (bytes32 => mapping (address => bool)) public signedTransactions;

     modifier onlyMember() {
		require(isMember[_msgSender()], "Federation: Not Federator");
		_;
	} 

    event TransactionUpdated (bytes32 indexed transactionId,address indexed member, bool signed);
    event MemberAddition(address indexed member);
    event MemberRemoval(address indexed member);
        
    function initialize(
		address[] calldata _members,
		address owner
	) public initializer {
		UpgradableOwnable.initialize(owner);
        require(_members.length <= MAX_MEMBER_COUNT, "Federation: Too many members");
		members = _members;
		for (uint i = 0; i < _members.length; i++) {
			require(!isMember[_members[i]] && _members[i] != NULL_ADDRESS, "Federation: Invalid members");
			isMember[_members[i]] = true;
			emit MemberAddition(_members[i]);
		}
    }

    function updateTransactionstate(bytes32 transactionId, bool signed) external onlyMember {
        signedTransactions[transactionId][_msgSender()] = signed;
        emit TransactionUpdated(transactionId, _msgSender(),signed);
    }

    function addMember(address _newMember) external onlyOwner {
		require(_newMember != NULL_ADDRESS, "Federation: Empty member");
		require(!isMember[_newMember], "Federation: Member already exists");
		
		isMember[_newMember] = true;
		members.push(_newMember);
		emit MemberAddition(_newMember);
	}

	function removeMember(address _oldMember) external onlyOwner {
		require(_oldMember != NULL_ADDRESS, "Federation: Empty member");
		require(isMember[_oldMember], "Federation: Member doesn't exists");
		require(members.length > 1, "Federation: Can't remove all the members");
	
		isMember[_oldMember] = false;
		for (uint i = 0; i < members.length - 1; i++) {
			if (members[i] == _oldMember) {
				members[i] = members[members.length - 1];
				break;
			}
		}
		members.pop(); // remove an element from the end of the array.
		emit MemberRemoval(_oldMember);
	}

	/**
		@notice Return all the current members of the federation
		@return Current members
		*/
	function getMembers() external view  returns (address[] memory) {
		return members;
	}
}



