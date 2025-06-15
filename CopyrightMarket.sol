pragma solidity ^0.5.0;

import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/release-v2.5.0/contracts/drafts/Counters.sol";
import "./CopyrightAuction.sol";

contract CopyrightMarket {
    using Counters for Counters.Counter;

    Counters.Counter private copyright_ids;

    struct Work {
        address owner;
        string uri;
    }

    mapping(uint => Work) public copyrights;
    mapping(uint => CopyrightAuction) public auctions;

    event Copyright(uint copyright_id, address owner, string reference_uri);
    event OpenSource(uint copyright_id, string reference_uri);
    event Transfer(uint copyright_id, address new_owner);

    modifier onlyCopyrightOwner(uint copyright_id) {
        require(copyrights[copyright_id].owner == msg.sender, "Not the copyright owner");
        _;
    }

    // --- 1. CREATE COPYRIGHT (MINT)
    function createCopyright(string memory reference_uri) public {
        copyright_ids.increment();
        uint id = copyright_ids.current();

        copyrights[id] = Work(msg.sender, reference_uri);
        emit Copyright(id, msg.sender, reference_uri);
    }

    // --- 2. OPEN SOURCE
    function openSourceWork(uint copyright_id, string memory reference_uri) public onlyCopyrightOwner(copyright_id) {
        copyrights[copyright_id].uri = reference_uri;
        emit OpenSource(copyright_id, reference_uri);
    }

    // --- 3. TRANSFER OWNERSHIP
    function transferCopyrightOwnership(uint copyright_id, address new_owner) public onlyCopyrightOwner(copyright_id) {
        copyrights[copyright_id].owner = new_owner;
        emit Transfer(copyright_id, new_owner);
    }

    // --- 4. RENOUNCE (OPEN SOURCE)
    function renounceCopyrightOwnership(uint copyright_id) public onlyCopyrightOwner(copyright_id) {
        transferCopyrightOwnership(copyright_id, address(0));
        emit OpenSource(copyright_id, copyrights[copyright_id].uri);
    }

    // --- 5. CREATE AUCTION
    function createAuction(uint copyright_id) public onlyCopyrightOwner(copyright_id) {
        require(address(auctions[copyright_id]) == address(0), "Auction already exists");
        auctions[copyright_id] = new CopyrightAuction(msg.sender);
    }

    // --- 6. BID ON AUCTION
    function bid(uint copyright_id) public payable {
        CopyrightAuction auction = auctions[copyright_id];
        require(address(auction) != address(0), "Auction does not exist");
        auction.bid.value(msg.value)(msg.sender);
    }

    // --- 7. END AUCTION, TRANSFER COPYRIGHT TO WINNER
    function endAuction(uint copyright_id) public onlyCopyrightOwner(copyright_id) {
        CopyrightAuction auction = auctions[copyright_id];
        auction.auctionEnd(msg.sender);
        // Transfer ownership to highest bidder
        address winner = auction.highestBidder();
        copyrights[copyright_id].owner = winner;
        emit Transfer(copyright_id, winner);
    }

    // --- 8. VIEW AUCTION INFO
    function highestBid(uint copyright_id) public view returns (uint) {
        return auctions[copyright_id].highestBid();
    }

    function auctionEnded(uint copyright_id) public view returns (bool) {
        return auctions[copyright_id].ended();
    }

    function pendingReturn(uint copyright_id, address sender) public view returns (uint) {
        return auctions[copyright_id].pendingReturn(sender);
    }
}
