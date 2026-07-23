import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { itemModel } from "../models/itemModel.js";

export const itemController = {
  async getItems(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const items = await itemModel.findMany({ user: req.user.id });
      res.json({ items });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },

  async createItem(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const { title, name, shortDescription, description, fullDescription, price, imageUrl, category } = req.body;

      const item = await itemModel.create({
        title: title || name || "Diagnostic Item",
        name: name || title,
        shortDescription: shortDescription || description,
        description,
        fullDescription,
        price: Number(price || 0),
        imageUrl: imageUrl || "https://images.unsplash.com/photo-1530026405186-ed1ea0ac7a63?auto=format&fit=crop&q=80&w=300",
        category,
        user: req.user.id
      });

      res.status(201).json({ message: "Item added successfully", item });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  async updateItem(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      await itemModel.update(req.params.id, req.user.id, req.body);
      res.json({ message: "Item updated successfully" });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  },

  async deleteItem(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return res.status(401).json({ error: "Not authenticated" });
      const success = await itemModel.delete(req.params.id, req.user.id);
      if (!success) return res.status(404).json({ error: "Item not found or unauthorized to delete" });
      res.json({ message: "Item deleted successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
};
