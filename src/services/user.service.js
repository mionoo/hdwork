const userRepository = require("../repositories/user.repository");

module.exports = {
  listUsers: (actorId, filters) => userRepository.listUsers(actorId, filters),
  getOptions: (actorId) => userRepository.getOptions(actorId),
  createUser: (actorId, payload) => userRepository.createUser(actorId, payload),
  updateUser: (actorId, userId, payload) => userRepository.updateUser(actorId, userId, payload),
  resetPassword: (actorId, userId, password) => userRepository.resetPassword(actorId, userId, password),
};
