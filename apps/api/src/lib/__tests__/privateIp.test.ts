import { describe, expect, it } from "vitest";
import { isBlockedIp, isPrivateIpv4, isPrivateIpv6 } from "../privateIp";

describe("isPrivateIpv4", () => {
    it("blocks RFC1918 / loopback / link-local / CGNAT / reserved ranges", () => {
        for (const ip of [
            "0.0.0.0",
            "10.0.0.1",
            "10.255.255.255",
            "127.0.0.1",
            "100.64.0.1",
            "100.127.255.255",
            "169.254.169.254", // cloud metadata
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.19.255.255",
            "224.0.0.1", // multicast
            "255.255.255.255",
        ]) {
            expect(isPrivateIpv4(ip), ip).toBe(true);
        }
    });

    it("allows public addresses", () => {
        for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "203.0.100.5"]) {
            expect(isPrivateIpv4(ip), ip).toBe(false);
        }
    });

    it("fails closed on malformed input", () => {
        for (const ip of ["", "1.2.3", "1.2.3.4.5", "abc"]) {
            expect(isPrivateIpv4(ip), JSON.stringify(ip)).toBe(true);
        }
    });
});

describe("isPrivateIpv6", () => {
    it("blocks loopback / unspecified / ULA / link-local", () => {
        for (const ip of [
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "feaf::1",
        ]) {
            expect(isPrivateIpv6(ip), ip).toBe(true);
        }
    });

    it("blocks dotted IPv4-mapped addresses that embed a private IPv4", () => {
        expect(isPrivateIpv6("::ffff:192.168.0.1")).toBe(true);
        expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
        expect(isPrivateIpv6("::ffff:169.254.169.254")).toBe(true);
        expect(isPrivateIpv6("::ffff:8.8.8.8")).toBe(false);
    });

    it("blocks hex-form IPv4-mapped addresses (::ffff:c0a8:0001)", () => {
        expect(isPrivateIpv6("::ffff:c0a8:0001")).toBe(true); // 192.168.0.1
        expect(isPrivateIpv6("::ffff:7f00:0001")).toBe(true); // 127.0.0.1
        expect(isPrivateIpv6("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
        expect(isPrivateIpv6("::ffff:0808:0808")).toBe(false); // 8.8.8.8
    });

    it("blocks NAT64 (64:ff9b::/96) addresses that embed a private IPv4", () => {
        expect(isPrivateIpv6("64:ff9b::c0a8:1")).toBe(true); // 192.168.0.1
        expect(isPrivateIpv6("64:ff9b::10.0.0.1")).toBe(true); // dotted tail
        expect(isPrivateIpv6("64:ff9b::a9fe:a9fe")).toBe(true); // 169.254.169.254
        expect(isPrivateIpv6("64:ff9b::808:808")).toBe(false); // 8.8.8.8
    });

    it("blocks 6to4 (2002::/16) addresses that embed a private IPv4", () => {
        expect(isPrivateIpv6("2002:c0a8:0001::")).toBe(true); // 192.168.0.1
        expect(isPrivateIpv6("2002:7f00:0001::")).toBe(true); // 127.0.0.1
        expect(isPrivateIpv6("2002:a9fe:a9fe::")).toBe(true); // 169.254.169.254
        expect(isPrivateIpv6("2002:0808:0808::")).toBe(false); // 8.8.8.8
    });

    it("allows global unicast addresses", () => {
        for (const ip of [
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
            "2620:fe::fe",
        ]) {
            expect(isPrivateIpv6(ip), ip).toBe(false);
        }
    });
});

describe("isBlockedIp", () => {
    it("routes IPv4 / IPv6 to the right classifier", () => {
        expect(isBlockedIp("8.8.8.8")).toBe(false);
        expect(isBlockedIp("10.0.0.1")).toBe(true);
        expect(isBlockedIp("::1")).toBe(true);
        expect(isBlockedIp("2002:c0a8:0001::")).toBe(true);
        expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    });

    it("fails closed on non-IP input", () => {
        expect(isBlockedIp("example.com")).toBe(true);
        expect(isBlockedIp("")).toBe(true);
        expect(isBlockedIp("not-an-ip")).toBe(true);
    });
});
