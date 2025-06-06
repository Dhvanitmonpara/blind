import { io } from "./app.js";

const handleSocketError = (socket: any, error: any) => {
  console.error(`Socket ${socket.id} error:`, error);
  socket.emit("operation-error", {
    code: error.code || "GENERIC_ERROR",
    message: error.message,
  });
};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.emit("user-connected", { socketId: socket.id });

  socket.on("initial-setup", (data) => {
    try {
      
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("disconnect", () => {
    try {
      console.log(`User disconnected: ${socket.id}`);
    } catch (error) {
      handleSocketError(socket, error);
    }
  });
});