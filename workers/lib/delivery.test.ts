// Copyright (c) 2026 Postbox contributors.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/APACHE-2.0

import { describe, expect, it } from "vitest";
import {
	deliveryRates,
	isTerminalStatus,
	isValidDeliveryEvent,
	nextDeliveryStatus,
	type DeliveryEventType,
	type DeliveryStatus,
} from "./delivery";

describe("nextDeliveryStatus", () => {
	it("accepts the happy path queued -> sent -> delivered", () => {
		expect(nextDeliveryStatus("queued", "sent")).toBe("sent");
		expect(nextDeliveryStatus("sent", "delivered")).toBe("delivered");
	});

	it("accepts send_failed from queued and sent", () => {
		expect(nextDeliveryStatus("queued", "send_failed")).toBe("send_failed");
		expect(nextDeliveryStatus("sent", "send_failed")).toBe("send_failed");
	});

	it("accepts webhook events that arrive before sent was recorded", () => {
		expect(nextDeliveryStatus("queued", "delivered")).toBe("delivered");
		expect(nextDeliveryStatus("queued", "bounced")).toBe("bounced");
		expect(nextDeliveryStatus("queued", "complained")).toBe("complained");
	});

	it("allows bounce and complaint after delivery", () => {
		expect(nextDeliveryStatus("delivered", "bounced")).toBe("bounced");
		expect(nextDeliveryStatus("delivered", "complained")).toBe("complained");
		expect(nextDeliveryStatus("bounced", "complained")).toBe("complained");
	});

	it("treats opened as informational — status is unchanged", () => {
		expect(nextDeliveryStatus("sent", "opened")).toBe("sent");
		expect(nextDeliveryStatus("delivered", "opened")).toBe("delivered");
	});

	it("rejects re-applying queued", () => {
		expect(nextDeliveryStatus("queued", "queued")).toBeNull();
		expect(nextDeliveryStatus("sent", "queued")).toBeNull();
	});

	it("rejects backward and lateral moves", () => {
		expect(nextDeliveryStatus("delivered", "sent")).toBeNull();
		expect(nextDeliveryStatus("delivered", "delivered")).toBeNull();
		expect(nextDeliveryStatus("sent", "sent")).toBeNull();
		expect(nextDeliveryStatus("bounced", "delivered")).toBeNull();
	});

	it("rejects any move out of terminal states (except bounced -> complained)", () => {
		expect(nextDeliveryStatus("send_failed", "delivered")).toBeNull();
		expect(nextDeliveryStatus("complained", "bounced")).toBeNull();
		expect(nextDeliveryStatus("complained", "opened")).toBeNull();
		expect(nextDeliveryStatus("bounced", "sent")).toBeNull();
	});

	it("rejects opened from queued (nothing delivered yet)", () => {
		expect(nextDeliveryStatus("queued", "opened")).toBeNull();
	});
});

describe("isTerminalStatus", () => {
	it("marks send_failed, bounced, complained as terminal", () => {
		expect(isTerminalStatus("send_failed")).toBe(true);
		expect(isTerminalStatus("bounced")).toBe(true);
		expect(isTerminalStatus("complained")).toBe(true);
	});

	it("marks queued, sent, delivered as non-terminal", () => {
		expect(isTerminalStatus("queued")).toBe(false);
		expect(isTerminalStatus("sent")).toBe(false);
		expect(isTerminalStatus("delivered")).toBe(false);
	});
});

describe("isValidDeliveryEvent", () => {
	it("mirrors nextDeliveryStatus nullability", () => {
		const statuses: DeliveryStatus[] = ["queued", "sent", "send_failed", "delivered", "bounced", "complained"];
		const events: DeliveryEventType[] = ["queued", "sent", "send_failed", "delivered", "bounced", "complained", "opened"];
		for (const s of statuses) {
			for (const e of events) {
				expect(isValidDeliveryEvent(s, e)).toBe(nextDeliveryStatus(s, e) !== null);
			}
		}
	});
});

describe("deliveryRates", () => {
	it("computes delivery, bounce, and complaint rates", () => {
		const r = deliveryRates({ sent: 100, delivered: 90, bounced: 5, complained: 2 });
		expect(r.deliveryRate).toBeCloseTo(0.9);
		expect(r.bounceRate).toBeCloseTo(0.05);
		expect(r.complaintRate).toBeCloseTo(0.02);
	});

	it("returns zeros when nothing was sent", () => {
		expect(deliveryRates({ sent: 0, delivered: 0, bounced: 0, complained: 0 })).toEqual({
			deliveryRate: 0,
			bounceRate: 0,
			complaintRate: 0,
		});
	});

	it("clamps rates to [0, 1] on inconsistent input", () => {
		const r = deliveryRates({ sent: 10, delivered: 50, bounced: -3, complained: 12 });
		expect(r.deliveryRate).toBe(1);
		expect(r.bounceRate).toBe(0);
		expect(r.complaintRate).toBe(1);
	});
});
