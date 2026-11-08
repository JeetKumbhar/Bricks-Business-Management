import * as customers from "../services/customer.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const list = async (req, res) => {
  const { items, meta } = await customers.listCustomers(req.query);
  return sendSuccess(res, { message: "Customers fetched successfully", data: items, meta });
};
export const getOne = async (req, res) => sendSuccess(res, { message: "Customer fetched successfully", data: await customers.getCustomer(req.params.id) });
export const create = async (req, res) => sendSuccess(res, { statusCode: 201, message: "Customer saved", data: await customers.createCustomer(req.body, req.user) });
export const update = async (req, res) => sendSuccess(res, { message: "Customer updated", data: await customers.updateCustomer(req.params.id, req.body, req.user) });
export const archive = async (req, res) => sendSuccess(res, { message: "Customer archived", data: await customers.archiveCustomer(req.params.id, req.body, req.user) });
export const restore = async (req, res) => sendSuccess(res, { message: "Customer restored", data: await customers.restoreCustomer(req.params.id, req.body ?? {}, req.user) });
export const internal = async (req, res) => {
  const { customer, created } = await customers.ensureInternalCustomer(req.user);
  return sendSuccess(res, { statusCode: created ? 201 : 200, message: created ? "Internal customer created" : "Internal customer already exists", data: customer });
};
