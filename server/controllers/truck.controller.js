import * as trucks from "../services/truck.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { TRUCK_STATUS } from "../constants/truck.js";

const listFor = (status) => async (req, res) => {
  const { items, counts } = await trucks.listTrucks({ ...req.query, ...(status ? { status } : {}) });
  return sendSuccess(res, { message: "Trucks fetched successfully", data: items, meta: { counts } });
};

export const list = listFor();
export const listWorking = listFor(TRUCK_STATUS.WORKING);
export const listStopped = listFor(TRUCK_STATUS.STOPPED);
export const create = async (req, res) => sendSuccess(res, { statusCode: 201, message: "Truck added successfully", data: await trucks.createTruck(req.body, req.user) });
export const getOne = async (req, res) => sendSuccess(res, { message: "Truck fetched successfully", data: await trucks.getTruck(req.params.id) });
export const update = async (req, res) => sendSuccess(res, { message: "Truck updated successfully", data: await trucks.updateTruck(req.params.id, req.body, req.user) });
export const changeStatus = async (req, res) => {
  const { truck, historyEntry } = await trucks.changeStatus(req.params.id, req.body, req.user);
  return sendSuccess(res, { message: "Truck status changed successfully", data: truck, meta: { historyEntry } });
};
export const history = async (req, res) => sendSuccess(res, { message: "Truck history fetched successfully", data: await trucks.getHistory(req.params.id) });
