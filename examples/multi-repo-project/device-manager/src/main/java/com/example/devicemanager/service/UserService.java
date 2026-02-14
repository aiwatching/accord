package com.example.devicemanager.service;

import com.example.devicemanager.dto.BatchDeleteRequest;
import com.example.devicemanager.dto.BatchDeleteResponse;
import com.example.devicemanager.model.User;
import com.example.devicemanager.model.UserStatus;

import java.util.List;
import java.util.Optional;

public interface UserService {
    List<User> getAllUsers();
    Optional<User> getUserById(String id);
    Optional<User> getUserByUsername(String username);
    List<User> getUsersByStatus(UserStatus status);
    User createUser(User user);
    User updateUser(String id, User user);
    boolean deleteUser(String id);
    BatchDeleteResponse batchDeleteUsers(BatchDeleteRequest request);
}
